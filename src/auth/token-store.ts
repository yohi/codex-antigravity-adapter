import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

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
};

const DEFAULT_TOKEN_PATH = path.join(
  os.homedir(),
  ".codex",
  "antigravity-tokens.json"
);

export class FileTokenStore {
  private filePath: string;
  private now: () => number;

  constructor(options: TokenStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_TOKEN_PATH;
    this.now = options.now ?? (() => Date.now());
  }

  async getAccessToken(): Promise<
    Result<{ accessToken: string; projectId: string }, TokenError>
  > {
    const loaded = await this.loadTokens();
    if (!loaded.ok) {
      return loaded;
    }
    const tokens = loaded.value;
    if (tokens.expiresAt <= this.now()) {
      return {
        ok: false,
        error: {
          code: "EXPIRED",
          message: "Access token expired",
          requiresReauth: true,
        },
      };
    }
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
