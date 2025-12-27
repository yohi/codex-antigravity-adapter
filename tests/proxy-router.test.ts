import { describe, expect, it } from "bun:test";

import { createProxyApp, startProxyServer } from "../src/proxy/proxy-router";

type TokenStore = {
  getAccessToken: () => Promise<
    | { ok: true; value: { accessToken: string; projectId: string } }
    | { ok: false; error: { requiresReauth: boolean; message: string } }
  >;
};

type TransformService = {
  handleCompletion: (
    request: unknown,
    tokens: { accessToken: string; projectId: string }
  ) => Promise<
    | { ok: true; value: unknown }
    | { ok: false; error: { statusCode: number; message: string } }
  >;
};

function createTokenStoreStub(
  overrides: Partial<TokenStore> = {}
): TokenStore {
  return {
    getAccessToken: async () => ({
      ok: false,
      error: { requiresReauth: true, message: "Missing token" },
    }),
    ...overrides,
  };
}

function createTransformServiceStub(
  overrides: Partial<TransformService> = {}
): TransformService {
  return {
    handleCompletion: async () => ({
      ok: true,
      value: { ok: true },
    }),
    ...overrides,
  };
}

describe("Proxy router", () => {
  it("returns 401 with authentication guidance when unauthenticated", async () => {
    const app = createProxyApp({
      tokenStore: createTokenStoreStub(),
      transformService: createTransformServiceStub(),
    });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gemini-3-flash", messages: [] }),
    });

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload).toEqual({
      error: {
        type: "authentication_error",
        code: "invalid_api_key",
        message:
          "Authentication required. Please visit http://localhost:51121/login to sign in.",
      },
    });
  });

  it("returns 400 when request validation fails", async () => {
    const app = createProxyApp({
      tokenStore: createTokenStoreStub({
        getAccessToken: async () => ({
          ok: true,
          value: { accessToken: "token", projectId: "project-id" },
        }),
      }),
      transformService: createTransformServiceStub(),
    });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gemini-3-flash" }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.type).toBe("invalid_request_error");
    expect(payload.error.code).toBe("invalid_request");
  });

  it("delegates to TransformService for valid requests", async () => {
    let captured: unknown | null = null;
    let capturedTokens: { accessToken: string; projectId: string } | null = null;
    const app = createProxyApp({
      tokenStore: createTokenStoreStub({
        getAccessToken: async () => ({
          ok: true,
          value: { accessToken: "token", projectId: "project-id" },
        }),
      }),
      transformService: createTransformServiceStub({
        handleCompletion: async (request, tokens) => {
          captured = request;
          capturedTokens = tokens;
          return { ok: true, value: { id: "resp-1" } };
        },
      }),
    });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gemini-3-flash", messages: [] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "resp-1" });
    expect(captured).toBeTruthy();
    expect(capturedTokens).toEqual({ accessToken: "token", projectId: "project-id" });
  });

  it("returns a fixed model list from /v1/models", async () => {
    const app = createProxyApp({
      tokenStore: createTokenStoreStub(),
      transformService: createTransformServiceStub(),
    });

    const response = await app.request("http://localhost/v1/models");
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(Array.isArray(payload.data)).toBe(true);
    const ids = payload.data.map((model: { id: string }) => model.id);
    expect(ids).toEqual([
      "gemini-3-pro-high",
      "gemini-3-pro-low",
      "gemini-3-flash",
      "claude-sonnet-4-5",
      "claude-sonnet-4-5-thinking",
      "claude-opus-4-5-thinking",
      "gpt-oss-120b-medium",
    ]);
  });

  it("returns 404 for unknown endpoints", async () => {
    const app = createProxyApp({
      tokenStore: createTokenStoreStub(),
      transformService: createTransformServiceStub(),
    });

    const response = await app.request("http://localhost/unknown");
    expect(response.status).toBe(404);

    const payload = await response.json();
    expect(payload).toEqual({
      error: {
        type: "invalid_request_error",
        code: "unknown_endpoint",
        message: "Unknown endpoint",
      },
    });
  });

  it("starts the proxy server on the default port", () => {
    const app = createProxyApp({
      tokenStore: createTokenStoreStub(),
      transformService: createTransformServiceStub(),
    });
    let captured: { port: number; hostname: string } | null = null;

    const server = startProxyServer(app, {
      serve: (options) => {
        captured = { port: options.port, hostname: options.hostname };
        return { stop: () => undefined };
      },
    });

    expect(captured).toEqual({ port: 3000, hostname: "127.0.0.1" });
    expect(server).toBeDefined();
  });
});
