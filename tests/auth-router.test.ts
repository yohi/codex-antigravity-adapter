import { describe, expect, it } from "bun:test";

import type { AuthService } from "../src/auth/auth-service";
import { createAuthApp, startAuthServer } from "../src/auth/auth-router";

function createAuthServiceStub(overrides: Partial<AuthService> = {}): AuthService {
  return {
    generateAuthUrl: () => ({
      ok: true,
      value: {
        url: "https://example.com/oauth",
        state: "state.token",
      },
    }),
    exchangeToken: async () => ({
      ok: true,
      value: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: Date.now() + 3600_000,
        projectId: "project-id",
      },
    }),
    isAuthenticated: async () => true,
    ...overrides,
  };
}

describe("Auth router", () => {
  it("redirects /login to the OAuth authorization URL", async () => {
    const app = createAuthApp(createAuthServiceStub());
    const response = await app.request("http://localhost/login");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/oauth");
  });

  it("returns 400 when /oauth-callback is missing required params", async () => {
    const app = createAuthApp(createAuthServiceStub());
    const response = await app.request("http://localhost/oauth-callback?code=abc");

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("Missing");
  });

  it("returns 400 when state validation fails", async () => {
    const app = createAuthApp(
      createAuthServiceStub({
        exchangeToken: async () => ({
          ok: false,
          error: { code: "INVALID_STATE", message: "Invalid state" },
        }),
      })
    );
    const response = await app.request(
      "http://localhost/oauth-callback?code=abc&state=bad"
    );

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("Invalid state");
  });

  it("returns a success page when token exchange succeeds", async () => {
    const app = createAuthApp(createAuthServiceStub());
    const response = await app.request(
      "http://localhost/oauth-callback?code=abc&state=good"
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Authentication complete");
  });

  it("returns auth status as JSON", async () => {
    const app = createAuthApp(
      createAuthServiceStub({
        isAuthenticated: async () => false,
      })
    );
    const response = await app.request("http://localhost/auth/status");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ authenticated: false });
  });

  it("starts the auth server on the default port", () => {
    const app = createAuthApp(createAuthServiceStub());
    let captured: { port: number; hostname: string } | null = null;

    const server = startAuthServer(app, {
      serve: (options) => {
        captured = { port: options.port, hostname: options.hostname };
        return { stop: () => undefined };
      },
    });

    expect(captured).toEqual({ port: 51121, hostname: "127.0.0.1" });
    expect(server).toBeDefined();
  });
});
