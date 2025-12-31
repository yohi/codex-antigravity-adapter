import { describe, expect, it } from "bun:test";

import type { ModelCatalog } from "../src/config/model-settings-service";
import { DEFAULT_FIXED_MODEL_IDS } from "../src/config/model-settings-service";
import { createProxyApp, startProxyServer } from "../src/proxy/proxy-router";
import type { ModelRoutingService } from "../src/proxy/model-routing-service";

type TransformService = {
  handleCompletion: (
    request: unknown
  ) => Promise<
    | { ok: true; value: unknown }
    | {
        ok: false;
        error: {
          code: string;
          statusCode: number;
          message: string;
          upstream?: { type: string; code: string };
          retryAfter?: string;
        };
      }
  >;
};

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

function createTestCatalog(ids: string[]): ModelCatalog {
  return {
    models: ids.map((id) => ({
      id,
      object: "model",
      created: 1_700_000_000,
      owned_by: "antigravity",
    })),
    sources: {
      env: ids.length,
      file: 0,
      fixed: 0,
    },
  };
}

describe("Proxy router", () => {
  it("attaches the provided model catalog to the app", () => {
    const catalog = createTestCatalog(["custom-model"]);
    const app = createProxyApp({
      transformService: createTransformServiceStub(),
      modelCatalog: catalog,
    });

    const attached = (app as { modelCatalog?: ModelCatalog }).modelCatalog;
    expect(attached).toEqual(catalog);
  });

  it("creates a default model catalog when one is not provided", () => {
    const app = createProxyApp({
      transformService: createTransformServiceStub(),
    });

    const attached = (app as { modelCatalog?: ModelCatalog }).modelCatalog;
    expect(attached?.sources).toEqual({
      env: 0,
      file: 0,
      fixed: DEFAULT_FIXED_MODEL_IDS.length,
    });
    expect(attached?.models.map((model) => model.id)).toEqual(DEFAULT_FIXED_MODEL_IDS);
    expect(
      attached?.models.every(
        (model) => model.object === "model" && model.owned_by === "antigravity"
      )
    ).toBe(true);
  });

  it("returns 401 with authentication guidance when unauthenticated", async () => {
    const app = createProxyApp({
      transformService: createTransformServiceStub({
        handleCompletion: async () => ({
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            statusCode: 401,
            message:
              "Authentication required. Please visit http://localhost:51121/login to sign in.",
          },
        }),
      }),
    });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-flash",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Hello." }],
          },
        ],
      }),
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

  it("returns upstream error mappings and retry-after header when provided", async () => {
    const app = createProxyApp({
      transformService: createTransformServiceStub({
        handleCompletion: async () => ({
          ok: false,
          error: {
            code: "UPSTREAM_ERROR",
            statusCode: 429,
            message: "Rate limit exceeded",
            upstream: {
              type: "rate_limit_error",
              code: "rate_limit_exceeded",
            },
            retryAfter: "120",
          },
        }),
      }),
    });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-flash",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Hello." }],
          },
        ],
      }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    const payload = await response.json();
    expect(payload).toEqual({
      error: {
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
        message: "Rate limit exceeded",
      },
    });
  });

  it("returns 400 when request validation fails", async () => {
    const app = createProxyApp({
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

  it("delegates to TransformService with validated request when routing is not configured", async () => {
    let captured: unknown | null = null;
    const app = createProxyApp({
      transformService: createTransformServiceStub({
        handleCompletion: async (request) => {
          captured = request;
          return { ok: true, value: { id: "resp-1" } };
        },
      }),
    });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-flash",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Hello." }],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "resp-1" });
    expect(captured).toMatchObject({
      model: "gemini-3-flash",
      messages: [{ role: "user", content: "Hello." }],
    });
  });

  it("routes requests before delegating to TransformService when configured", async () => {
    let routedRequest: unknown | null = null;
    let transformedRequest: unknown | null = null;
    const callSequence: string[] = [];
    let routedContent: string | null = null;
    const modelRoutingService: ModelRoutingService = {
      route: (request) => {
        routedRequest = request;
        callSequence.push("route");
        const lastMessage = request.messages[request.messages.length - 1];
        if (lastMessage?.role === "user") {
          const content = lastMessage.content;
          routedContent = typeof content === "string" ? content : null;
        } else {
          routedContent = null;
        }
        return {
          request: {
            ...request,
            model: "gemini-3-pro-high",
          },
          routed: true,
          detectedAlias: "@fast",
          originalModel: request.model,
        };
      },
    };
    const app = createProxyApp({
      transformService: createTransformServiceStub({
        handleCompletion: async (request) => {
          transformedRequest = request;
          callSequence.push("transform");
          return { ok: true, value: { id: "resp-2" } };
        },
      }),
      modelRoutingService,
    });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-flash",
        stream: false,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "@fast hello" }],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "resp-2" });
    expect(routedRequest).toMatchObject({
      model: "gemini-3-flash",
      messages: [{ role: "user", content: "@fast hello" }],
    });
    expect(transformedRequest).toMatchObject({
      model: "gemini-3-pro-high",
      messages: [{ role: "user", content: "@fast hello" }],
    });
    expect(callSequence).toEqual(["route", "transform"]);
    expect(routedContent).toBe("@fast hello");
  });

  it("returns a fixed model list from /v1/models", async () => {
    const app = createProxyApp({
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

  it("returns the injected model catalog from /v1/models", async () => {
    const catalog = createTestCatalog(["custom-a", "custom-b"]);
    const app = createProxyApp({
      transformService: createTransformServiceStub(),
      modelCatalog: catalog,
    });

    const response = await app.request("http://localhost/v1/models");
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toEqual({
      object: "list",
      data: catalog.models,
    });
  });

  it("returns 404 for unknown endpoints", async () => {
    const app = createProxyApp({
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

  it("returns OpenAI-compatible error payloads for unexpected failures", async () => {
    const app = createProxyApp({
      transformService: createTransformServiceStub({
        handleCompletion: async () => {
          throw new Error("Unexpected failure");
        },
      }),
    });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gemini-3-flash", messages: [] }),
    });

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload).toEqual({
      error: {
        type: "server_error",
        code: "internal_error",
        message: "Unexpected failure",
      },
    });
  });

  it("starts the proxy server on the default port", () => {
    const app = createProxyApp({
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
