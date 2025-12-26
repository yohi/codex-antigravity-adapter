import { describe, expect, it } from "bun:test";
import { createHash, createHmac } from "node:crypto";

import { InMemoryAuthSessionStore } from "../src/auth/auth-session-store";
import { OAuthAuthService } from "../src/auth/auth-service";
import {
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_PROD,
  GOOGLE_OAUTH_TOKEN_URL,
} from "../src/config/antigravity";
import type { Result, TokenError, TokenPair } from "../src/auth/token-store";

const STATE_SECRET = "test-secret";

function signState(stateId: string, secret: string): string {
  return createHmac("sha256", secret).update(stateId).digest("base64url");
}

function toCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function createTokenStoreStub() {
  const saved: TokenPair[] = [];
  const store = {
    async saveTokens(tokens: TokenPair): Promise<Result<void, TokenError>> {
      saved.push(tokens);
      return { ok: true, value: undefined };
    },
    async getAccessToken(): Promise<
      Result<{ accessToken: string; projectId: string }, TokenError>
    > {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "not found",
          requiresReauth: true,
        },
      };
    },
  };
  return { store, saved };
}

describe("InMemoryAuthSessionStore", () => {
  it("expires sessions after the TTL window", () => {
    let now = 1_000;
    const store = new InMemoryAuthSessionStore({
      now: () => now,
      ttlMs: 500,
    });
    store.save({ stateId: "state-1", codeVerifier: "verifier", createdAt: now });
    expect(store.get("state-1")).not.toBeNull();

    now = 1_600;
    expect(store.get("state-1")).toBeNull();
  });
});

describe("OAuthAuthService", () => {
  it("generates a signed auth URL and stores PKCE state", () => {
    const { store: tokenStore } = createTokenStoreStub();
    const sessionStore = new InMemoryAuthSessionStore();
    const service = new OAuthAuthService({
      tokenStore,
      sessionStore,
      stateSecret: STATE_SECRET,
    });

    const result = service.generateAuthUrl();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const url = new URL(result.value.url);
    const state = result.value.state;
    const [stateId, signature] = state.split(".");

    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(signature).toBe(signState(stateId, STATE_SECRET));

    const session = sessionStore.get(stateId);
    expect(session).not.toBeNull();
    if (!session) {
      return;
    }
    const expectedChallenge = toCodeChallenge(session.codeVerifier);
    expect(url.searchParams.get("code_challenge")).toBe(expectedChallenge);
  });

  it("rejects invalid state signatures on exchange", async () => {
    const { store: tokenStore } = createTokenStoreStub();
    const sessionStore = new InMemoryAuthSessionStore();
    const service = new OAuthAuthService({
      tokenStore,
      sessionStore,
      stateSecret: STATE_SECRET,
    });

    const result = await service.exchangeToken("code", "state.bad-signature");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_STATE");
    }
  });

  it("exchanges the auth code, resolves projectId, and saves tokens", async () => {
    const { store: tokenStore, saved } = createTokenStoreStub();
    const sessionStore = new InMemoryAuthSessionStore();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      requests.push({ url, init });
      if (url === GOOGLE_OAUTH_TOKEN_URL) {
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url === `${ANTIGRAVITY_ENDPOINT_PROD}/v1internal:loadCodeAssist`) {
        return new Response("upstream error", { status: 500 });
      }
      if (url === `${ANTIGRAVITY_ENDPOINT_DAILY}/v1internal:loadCodeAssist`) {
        return new Response(
          JSON.stringify({ cloudaicompanionProject: { id: "project-xyz" } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    };

    const service = new OAuthAuthService({
      tokenStore,
      sessionStore,
      stateSecret: STATE_SECRET,
      fetch: fetcher,
    });
    const auth = service.generateAuthUrl();
    expect(auth.ok).toBe(true);
    if (!auth.ok) {
      return;
    }

    const stateId = auth.value.state.split(".")[0];
    const session = sessionStore.get(stateId);
    expect(session).not.toBeNull();
    if (!session) {
      return;
    }

    const exchange = await service.exchangeToken("auth-code", auth.value.state);
    expect(exchange.ok).toBe(true);
    if (!exchange.ok) {
      return;
    }

    expect(saved.length).toBe(1);
    expect(saved[0].accessToken).toBe("access-token");
    expect(saved[0].refreshToken).toBe("refresh-token");
    expect(saved[0].projectId).toBe("project-xyz");

    const tokenRequest = requests.find(
      (request) => request.url === GOOGLE_OAUTH_TOKEN_URL
    );
    expect(tokenRequest).toBeDefined();
    const body = tokenRequest?.init?.body;
    const params =
      body instanceof URLSearchParams ? body : new URLSearchParams(String(body));
    expect(params.get("code_verifier")).toBe(session.codeVerifier);
  });

  it("returns an error when loadCodeAssist is forbidden and no fallback projectId", async () => {
    const { store: tokenStore } = createTokenStoreStub();
    const sessionStore = new InMemoryAuthSessionStore();
    const fetcher: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === GOOGLE_OAUTH_TOKEN_URL) {
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url === `${ANTIGRAVITY_ENDPOINT_PROD}/v1internal:loadCodeAssist`) {
        return new Response("forbidden", { status: 403 });
      }
      if (url === `${ANTIGRAVITY_ENDPOINT_DAILY}/v1internal:loadCodeAssist`) {
        return new Response("missing", { status: 404 });
      }
      if (url === `${ANTIGRAVITY_ENDPOINT_AUTOPUSH}/v1internal:loadCodeAssist`) {
        return new Response("missing", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    };

    const service = new OAuthAuthService({
      tokenStore,
      sessionStore,
      stateSecret: STATE_SECRET,
      fetch: fetcher,
      projectIdEnv: () => "",
      defaultProjectId: "",
    });
    const auth = service.generateAuthUrl();
    expect(auth.ok).toBe(true);
    if (!auth.ok) {
      return;
    }

    const exchange = await service.exchangeToken("auth-code", auth.value.state);
    expect(exchange.ok).toBe(false);
    if (!exchange.ok) {
      expect(exchange.error.code).toBe("TOKEN_EXCHANGE_FAILED");
      expect(exchange.error.message).toContain("Project ID is required");
    }
  });
});
