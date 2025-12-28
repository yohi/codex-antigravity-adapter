import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ACCESS_TOKEN_REFRESH_MARGIN_MS,
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  GOOGLE_OAUTH_TOKEN_URL,
  MAX_REFRESH_RETRIES,
  REFRESH_RETRY_BASE_MS,
  REFRESH_TOKEN_EXPIRY_MARGIN_MS,
} from "../config/antigravity";
import { NOOP_LOGGER, type Logger } from "../logging";

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshTokenExpiresAt?: number;
  projectId: string;
  scope?: string;
};

export type TokenError = {
  code: "NOT_FOUND" | "EXPIRED" | "REFRESH_FAILED" | "IO_ERROR";
  message: string;
  requiresReauth: boolean;
};

type TokenStoreOptions = {
  filePath?: string;
  now?: () => number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  fileExists?: (filePath: string) => Promise<boolean>;
  logger?: Logger;
};

type RefreshOutcome = {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  refreshTokenExpiresAt?: number;
  scope?: string;
};

const DEFAULT_TOKEN_PATH = path.join(
  os.homedir(),
  ".codex",
  "antigravity-tokens.json"
);

export class FileTokenStore {
  private filePath: string;
  private now: () => number;
  private fetcher: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private fileExists: (filePath: string) => Promise<boolean>;
  private logger: Logger;

  constructor(options: TokenStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_TOKEN_PATH;
    this.now = options.now ?? (() => Date.now());
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.fileExists = options.fileExists ?? defaultFileExists;
    this.logger = options.logger ?? NOOP_LOGGER;
  }

  async getAccessToken(): Promise<
    Result<{ accessToken: string; projectId: string }, TokenError>
  > {
    const loaded = await this.loadTokens();
    if (!loaded.ok) {
      return loaded;
    }
    const tokens = loaded.value;
    if (!tokens.projectId.trim()) {
      return {
        ok: false,
        error: {
          code: "IO_ERROR",
          message: "Project ID is missing",
          requiresReauth: true,
        },
      };
    }
    const now = this.now();
    if (shouldRefreshAccessToken(tokens, now)) {
      const refreshed = await this.refreshTokens(tokens, now);
      if (!refreshed.ok) {
        return refreshed;
      }
      return {
        ok: true,
        value: {
          accessToken: refreshed.value.accessToken,
          projectId: refreshed.value.projectId,
        },
      };
    }
    return {
      ok: true,
      value: { accessToken: tokens.accessToken, projectId: tokens.projectId },
    };
  }

  async saveTokens(tokens: TokenPair): Promise<Result<void, TokenError>> {
    if (!tokens.projectId.trim()) {
      return {
        ok: false,
        error: {
          code: "IO_ERROR",
          message: "Project ID is required",
          requiresReauth: true,
        },
      };
    }
    const payload = JSON.stringify(tokens, null, 2);
    try {
      await writeFileAtomic(this.filePath, payload);
      return { ok: true, value: undefined };
    } catch (error) {
      return toIoError("Failed to save tokens", error);
    }
  }

  async clearTokens(): Promise<Result<void, TokenError>> {
    try {
      await fs.rm(this.filePath, { force: true });
      return { ok: true, value: undefined };
    } catch (error) {
      return toIoError("Failed to clear tokens", error);
    }
  }

  private async refreshTokens(
    tokens: TokenPair,
    now: number
  ): Promise<Result<TokenPair, TokenError>> {
    this.logger.info("token_refresh_start", { expiresAt: tokens.expiresAt });
    if (!tokens.refreshToken.trim()) {
      return refreshFailed("Refresh token is missing");
    }
    if (isRefreshTokenExpired(tokens, now)) {
      return refreshFailed("Refresh token expired");
    }
    const exists = await this.ensureTokenFileExists();
    if (!exists.ok) {
      return exists;
    }
    const refreshed = await this.requestTokenRefresh(tokens.refreshToken, now);
    if (!refreshed.ok) {
      this.logger.error("token_refresh_failed", {
        code: refreshed.error.code,
        message: refreshed.error.message,
      });
      return refreshed;
    }
    const updated: TokenPair = {
      ...tokens,
      accessToken: refreshed.value.accessToken,
      refreshToken: refreshed.value.refreshToken ?? tokens.refreshToken,
      expiresAt: refreshed.value.expiresAt,
      refreshTokenExpiresAt:
        refreshed.value.refreshTokenExpiresAt ?? tokens.refreshTokenExpiresAt,
      scope: refreshed.value.scope ?? tokens.scope,
    };
    const saved = await this.saveTokens(updated);
    if (!saved.ok) {
      return saved;
    }
    this.logger.info("token_refresh_success", { expiresAt: updated.expiresAt });
    return { ok: true, value: updated };
  }

  private async requestTokenRefresh(
    refreshToken: string,
    now: number
  ): Promise<Result<RefreshOutcome, TokenError>> {
    for (let attempt = 1; attempt <= MAX_REFRESH_RETRIES; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(GOOGLE_OAUTH_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: ANTIGRAVITY_CLIENT_ID,
            client_secret: ANTIGRAVITY_CLIENT_SECRET,
          }),
        });
      } catch (error) {
        if (attempt < MAX_REFRESH_RETRIES) {
          await this.sleep(REFRESH_RETRY_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        return refreshFailed("Failed to refresh access token", error);
      }

      if (response.ok) {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          return refreshFailed("Invalid refresh response", error);
        }
        return parseRefreshResponse(payload, now);
      }

      const errorText = await readResponseText(response);
      const errorPayload = parseOAuthErrorPayload(errorText);
      const details = [errorPayload.code, errorPayload.description]
        .filter(Boolean)
        .join(": ");
      const message = details
        ? `Token refresh failed (${response.status} ${response.statusText}) - ${details}`
        : `Token refresh failed (${response.status} ${response.statusText})`;

      if (isRetryableStatus(response.status) && attempt < MAX_REFRESH_RETRIES) {
        await this.sleep(REFRESH_RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }

      return refreshFailed(message, errorText);
    }

    return refreshFailed("Failed to refresh access token");
  }

  private async ensureTokenFileExists(): Promise<Result<void, TokenError>> {
    try {
      const exists = await this.fileExists(this.filePath);
      if (!exists) {
        return {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "Token file was deleted",
            requiresReauth: true,
          },
        };
      }
      return { ok: true, value: undefined };
    } catch (error) {
      return toIoError("Failed to access token file", error);
    }
  }

  private async loadTokens(): Promise<Result<TokenPair, TokenError>> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: "Token file not found",
            requiresReauth: true,
          },
        };
      }
      return toIoError("Failed to read token file", error);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return toIoError("Invalid token file JSON", error);
    }

    return parseTokenPair(parsed);
  }
}

function parseTokenPair(parsed: unknown): Result<TokenPair, TokenError> {
  if (!isRecord(parsed)) {
    return {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: "Token file has invalid format",
        requiresReauth: true,
      },
    };
  }
  const accessToken = parsed.accessToken;
  const refreshToken = parsed.refreshToken;
  const expiresAt = parsed.expiresAt;
  const projectId = parsed.projectId;
  const refreshTokenExpiresAt = parsed.refreshTokenExpiresAt;
  const scope = parsed.scope;
  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    typeof projectId !== "string"
  ) {
    return {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: "Token file is missing required fields",
        requiresReauth: true,
      },
    };
  }
  if (refreshTokenExpiresAt !== undefined) {
    if (
      typeof refreshTokenExpiresAt !== "number" ||
      !Number.isFinite(refreshTokenExpiresAt)
    ) {
      return {
        ok: false,
        error: {
          code: "IO_ERROR",
          message: "refreshTokenExpiresAt must be a number",
          requiresReauth: true,
        },
      };
    }
  }
  if (scope !== undefined && typeof scope !== "string") {
    return {
      ok: false,
      error: {
        code: "IO_ERROR",
        message: "scope must be a string",
        requiresReauth: true,
      },
    };
  }
  return {
    ok: true,
    value: {
      accessToken,
      refreshToken,
      expiresAt,
      refreshTokenExpiresAt,
      projectId,
      scope,
    },
  };
}

type OAuthErrorPayload = {
  error?:
    | string
    | {
        code?: string;
        status?: string;
        message?: string;
      };
  error_description?: string;
};

function parseRefreshResponse(
  payload: unknown,
  now: number
): Result<RefreshOutcome, TokenError> {
  if (!isRecord(payload)) {
    return refreshFailed("Refresh response is not a JSON object");
  }
  const accessToken = payload.access_token;
  const expiresIn = payload.expires_in;
  if (
    typeof accessToken !== "string" ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn)
  ) {
    return refreshFailed("Refresh response is missing required fields");
  }
  const refreshToken =
    typeof payload.refresh_token === "string" ? payload.refresh_token : undefined;
  const refreshTokenExpiresIn = payload.refresh_token_expires_in;
  let refreshTokenExpiresAt: number | undefined;
  if (refreshTokenExpiresIn !== undefined) {
    if (
      typeof refreshTokenExpiresIn !== "number" ||
      !Number.isFinite(refreshTokenExpiresIn)
    ) {
      return refreshFailed("refresh_token_expires_in must be a number");
    }
    refreshTokenExpiresAt = now + refreshTokenExpiresIn * 1000;
  }
  const scope = typeof payload.scope === "string" ? payload.scope : undefined;
  return {
    ok: true,
    value: {
      accessToken,
      expiresAt: now + expiresIn * 1000,
      refreshToken,
      refreshTokenExpiresAt,
      scope,
    },
  };
}

function parseOAuthErrorPayload(text?: string): {
  code?: string;
  description?: string;
} {
  if (!text) {
    return {};
  }

  try {
    const payload = JSON.parse(text) as OAuthErrorPayload;
    if (!payload || typeof payload !== "object") {
      return { description: text };
    }

    let code: string | undefined;
    if (typeof payload.error === "string") {
      code = payload.error;
    } else if (payload.error && typeof payload.error === "object") {
      code = payload.error.status ?? payload.error.code;
      if (!payload.error_description && payload.error.message) {
        return { code, description: payload.error.message };
      }
    }

    if (payload.error_description) {
      return { code, description: payload.error_description };
    }

    if (payload.error && typeof payload.error === "object" && payload.error.message) {
      return { code, description: payload.error.message };
    }

    return { code };
  } catch {
    return { description: text };
  }
}

async function readResponseText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function shouldRefreshAccessToken(tokens: TokenPair, now: number): boolean {
  return tokens.expiresAt <= now + ACCESS_TOKEN_REFRESH_MARGIN_MS;
}

function isRefreshTokenExpired(tokens: TokenPair, now: number): boolean {
  if (tokens.refreshTokenExpiresAt === undefined) {
    return false;
  }
  return tokens.refreshTokenExpiresAt <= now + REFRESH_TOKEN_EXPIRY_MARGIN_MS;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

function refreshFailed(message: string, _error?: unknown): Result<never, TokenError> {
  return {
    ok: false,
    error: {
      code: "REFRESH_FAILED",
      message,
      requiresReauth: true,
    },
  };
}

function toIoError(message: string, error: unknown): Result<never, TokenError> {
  return {
    ok: false,
    error: {
      code: "IO_ERROR",
      message,
      requiresReauth: true,
    },
  };
}

async function writeFileAtomic(
  targetPath: string,
  contents: string
): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `${path.basename(targetPath)}.tmp.${process.pid}.${randomHex(8)}`
  );

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tempPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    if (handle) {
      await handle.close();
    }
  }

  if (process.platform !== "win32") {
    await fs.chmod(tempPath, 0o600);
  }

  try {
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }

  if (process.platform !== "win32") {
    await fs.chmod(targetPath, 0o600);
  }

  await fsyncDir(dir);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function fsyncDir(dir: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

function randomHex(size: number): string {
  return randomBytes(size).toString("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
