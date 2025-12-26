import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_METADATA,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_PROD,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
  GOOGLE_OAUTH_AUTH_URL,
  GOOGLE_OAUTH_TOKEN_URL,
} from "../config/antigravity";
import type { Result, TokenError, TokenPair } from "./token-store";
import {
  InMemoryAuthSessionStore,
  type AuthSession,
  type AuthSessionStore,
} from "./auth-session-store";

export type AuthError = {
  code: "INVALID_STATE" | "TOKEN_EXCHANGE_FAILED" | "NETWORK_ERROR";
  message: string;
  cause?: unknown;
};

export interface AuthService {
  generateAuthUrl(): Result<{ url: string; state: string }, AuthError>;
  exchangeToken(code: string, state: string): Promise<Result<TokenPair, AuthError>>;
  isAuthenticated(): Promise<boolean>;
}

type TokenStore = {
  saveTokens(tokens: TokenPair): Promise<Result<void, TokenError>>;
  getAccessToken(): Promise<
    Result<{ accessToken: string; projectId: string }, TokenError>
  >;
};

type AuthServiceOptions = {
  tokenStore: TokenStore;
  sessionStore?: AuthSessionStore;
  fetch?: typeof fetch;
  now?: () => number;
  stateSecret?: string | Buffer;
  projectIdEnv?: () => string | undefined;
  defaultProjectId?: string;
  requireStateSecret?: boolean; // If true, throw error when stateSecret is missing. If false, warn and generate.
};

const LOAD_ENDPOINTS = [
  ANTIGRAVITY_ENDPOINT_PROD,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
];

const PROJECT_ID_REQUIRED_MESSAGE =
  "Project ID is required. Set ANTIGRAVITY_PROJECT_ID.";

export class OAuthAuthService implements AuthService {
  private tokenStore: TokenStore;
  private sessionStore: AuthSessionStore;
  private fetcher: typeof fetch;
  private now: () => number;
  private stateSecret: Buffer;
  private projectIdEnv: () => string | undefined;
  private defaultProjectId: string;

  constructor(options: AuthServiceOptions) {
    this.tokenStore = options.tokenStore;
    this.sessionStore = options.sessionStore ?? new InMemoryAuthSessionStore();
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? (() => Date.now());

    // Check for state secret presence
    const rawSecret = options.stateSecret ?? process.env.ANTIGRAVITY_STATE_SECRET;
    const requireSecret = options.requireStateSecret ?? false;

    if (!rawSecret || (typeof rawSecret === "string" && rawSecret.length === 0)) {
      if (requireSecret) {
        throw new Error(
          "ANTIGRAVITY_STATE_SECRET is required but not provided. " +
          "Set ANTIGRAVITY_STATE_SECRET environment variable or pass stateSecret in options."
        );
      } else {
        console.warn(
          "WARNING: No persistent ANTIGRAVITY_STATE_SECRET is set. " +
          "A random secret will be generated, which will invalidate all existing OAuth states across restarts. " +
          "In multi-instance deployments, each instance will have a different secret, causing state validation failures. " +
          "Set ANTIGRAVITY_STATE_SECRET environment variable to avoid this issue."
        );
        this.stateSecret = randomBytes(32);
      }
    } else {
      this.stateSecret = normalizeSecret(rawSecret);
    }

    this.projectIdEnv = options.projectIdEnv ?? (() => process.env.ANTIGRAVITY_PROJECT_ID);
    this.defaultProjectId = options.defaultProjectId ?? ANTIGRAVITY_DEFAULT_PROJECT_ID;
  }

  generateAuthUrl(): Result<{ url: string; state: string }, AuthError> {
    const { codeVerifier, codeChallenge } = generatePkce();
    const stateId = randomBytes(16).toString("hex");
    const signature = signState(stateId, this.stateSecret);
    const state = `${stateId}.${signature}`;

    const session: AuthSession = {
      stateId,
      codeVerifier,
      createdAt: this.now(),
    };
    this.sessionStore.save(session);

    const url = new URL(GOOGLE_OAUTH_AUTH_URL);
    url.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", ANTIGRAVITY_REDIRECT_URI);
    url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "));
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");

    return { ok: true, value: { url: url.toString(), state } };
  }

  async exchangeToken(
    code: string,
    state: string
  ): Promise<Result<TokenPair, AuthError>> {
    const stateId = verifyState(state, this.stateSecret);
    if (!stateId) {
      return invalidState("Invalid OAuth state");
    }
    const session = this.sessionStore.get(stateId);
    if (!session) {
      return invalidState("OAuth state expired");
    }
    this.sessionStore.delete(stateId);

    let response: Response;
    try {
      response = await this.fetcher(GOOGLE_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: ANTIGRAVITY_CLIENT_ID,
          client_secret: ANTIGRAVITY_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: ANTIGRAVITY_REDIRECT_URI,
          code_verifier: session.codeVerifier,
        }),
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "NETWORK_ERROR",
          message: "Failed to reach OAuth token endpoint",
          cause: error,
        },
      };
    }

    if (!response.ok) {
      const errorText = await readResponseText(response);
      return {
        ok: false,
        error: {
          code: "TOKEN_EXCHANGE_FAILED",
          message: errorText
            ? `Token exchange failed: ${errorText}`
            : `Token exchange failed (${response.status})`,
        },
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "TOKEN_EXCHANGE_FAILED",
          message: "Token response is not valid JSON",
          cause: error,
        },
      };
    }

    const parsed = parseTokenPayload(payload, this.now());
    if (!parsed.ok) {
      return parsed;
    }

    const project = await resolveProjectId(
      this.fetcher,
      parsed.value.accessToken
    );
    const projectId = resolveProjectIdFallback(
      project.projectId,
      this.projectIdEnv(),
      this.defaultProjectId,
      project.sawForbidden
    );
    if (!projectId.ok) {
      return projectId;
    }

    const tokens: TokenPair = {
      accessToken: parsed.value.accessToken,
      refreshToken: parsed.value.refreshToken,
      expiresAt: parsed.value.expiresAt,
      refreshTokenExpiresAt: parsed.value.refreshTokenExpiresAt,
      scope: parsed.value.scope,
      projectId: projectId.value,
    };

    const saved = await this.tokenStore.saveTokens(tokens);
    if (!saved.ok) {
      return {
        ok: false,
        error: {
          code: "TOKEN_EXCHANGE_FAILED",
          message: saved.error.message,
          cause: saved.error,
        },
      };
    }

    return { ok: true, value: tokens };
  }

  async isAuthenticated(): Promise<boolean> {
    const result = await this.tokenStore.getAccessToken();
    return result.ok;
  }
}

type ParsedTokenPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshTokenExpiresAt?: number;
  scope?: string;
};

function parseTokenPayload(
  payload: unknown,
  now: number
): Result<ParsedTokenPayload, AuthError> {
  if (!isRecord(payload)) {
    return tokenExchangeFailed("Token response is missing required fields");
  }
  const accessToken = payload.access_token;
  const refreshToken = payload.refresh_token;
  const expiresIn = payload.expires_in;
  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn)
  ) {
    return tokenExchangeFailed("Token response is missing required fields");
  }

  const refreshTokenExpiresIn = payload.refresh_token_expires_in;
  let refreshTokenExpiresAt: number | undefined;
  if (refreshTokenExpiresIn !== undefined) {
    if (
      typeof refreshTokenExpiresIn !== "number" ||
      !Number.isFinite(refreshTokenExpiresIn)
    ) {
      return tokenExchangeFailed("refresh_token_expires_in must be a number");
    }
    refreshTokenExpiresAt = now + refreshTokenExpiresIn * 1000;
  }
  const scope = typeof payload.scope === "string" ? payload.scope : undefined;

  return {
    ok: true,
    value: {
      accessToken,
      refreshToken,
      expiresAt: now + expiresIn * 1000,
      refreshTokenExpiresAt,
      scope,
    },
  };
}

async function resolveProjectId(
  fetcher: typeof fetch,
  accessToken: string
): Promise<{ projectId: string; sawForbidden: boolean }> {
  let sawForbidden = false;
  for (const baseEndpoint of LOAD_ENDPOINTS) {
    let response: Response;
    try {
      response = await fetcher(`${baseEndpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "google-api-nodejs-client/9.15.1",
          "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
          "Client-Metadata": ANTIGRAVITY_CLIENT_METADATA,
        },
        body: JSON.stringify({
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      });
    } catch {
      continue;
    }

    if (response.status === 403 || response.status === 404) {
      sawForbidden = true;
      continue;
    }
    if (!response.ok) {
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      continue;
    }

    const projectId = extractProjectId(payload);
    if (projectId) {
      return { projectId, sawForbidden };
    }
  }

  return { projectId: "", sawForbidden };
}

function extractProjectId(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  const direct = payload.cloudaicompanionProject;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }
  if (isRecord(direct) && typeof direct.id === "string" && direct.id.trim()) {
    return direct.id;
  }
  return null;
}

function resolveProjectIdFallback(
  resolvedProjectId: string,
  envProjectId: string | undefined,
  defaultProjectId: string,
  sawForbidden: boolean
): Result<string, AuthError> {
  if (resolvedProjectId.trim()) {
    return { ok: true, value: resolvedProjectId };
  }

  const fallback = (envProjectId ?? defaultProjectId ?? "").trim();
  if (!fallback) {
    return tokenExchangeFailed(PROJECT_ID_REQUIRED_MESSAGE);
  }
  if (sawForbidden) {
    return tokenExchangeFailed(PROJECT_ID_REQUIRED_MESSAGE);
  }
  return { ok: true, value: fallback };
}

function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

function signState(stateId: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(stateId).digest("base64url");
}

function verifyState(state: string, secret: Buffer): string | null {
  const parts = state.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [stateId, signature] = parts;
  if (!stateId || !signature) {
    return null;
  }
  const expected = signState(stateId, secret);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }
  return stateId;
}

function invalidState(message: string): Result<never, AuthError> {
  return {
    ok: false,
    error: {
      code: "INVALID_STATE",
      message,
    },
  };
}

function tokenExchangeFailed(message: string): Result<never, AuthError> {
  return {
    ok: false,
    error: {
      code: "TOKEN_EXCHANGE_FAILED",
      message,
    },
  };
}

function normalizeSecret(secret: string | Buffer): Buffer {
  if (secret instanceof Buffer) {
    return secret;
  }
  if (typeof secret === "string" && secret.length > 0) {
    return Buffer.from(secret, "utf8");
  }
  throw new Error("normalizeSecret: secret must be a non-empty string or Buffer");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readResponseText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}
