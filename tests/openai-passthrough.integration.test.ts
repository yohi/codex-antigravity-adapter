import { describe, expect, it } from "bun:test";

import type { OpenAIConfigService } from "../src/config/openai-config-service";
import type { ModelRoutingService } from "../src/proxy/model-routing-service";
import { createOpenAIPassthroughService } from "../src/proxy/openai-passthrough-service";
import { createProxyApp } from "../src/proxy/proxy-router";
import type { TransformService } from "../src/proxy/transform-service";

type UpstreamCapture = {
  authorization: string | null;
  body: string;
  url: string;
};

function createConfigService(
  baseUrl: string,
  apiKey?: string
): OpenAIConfigService {
  return {
    getApiKey: () => apiKey,
    getBaseUrl: () => baseUrl,
    isConfigured: () => Boolean(apiKey),
  };
}

async function startUpstreamServer() {
  const received: UpstreamCapture[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body = await request.text();
      received.push({
        authorization: request.headers.get("authorization"),
        body,
        url: request.url,
      });
      return new Response(JSON.stringify({ id: "upstream-ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const baseUrl = `http://127.0.0.1:${server.port}`;
  return { server, baseUrl, received };
}

describe("Integration: OpenAI passthrough routing", () => {
  it("routes Gemini models to Antigravity and skips OpenAI passthrough", async () => {
    const { server, baseUrl, received } = await startUpstreamServer();
    try {
      let transformCalls = 0;
      const transformService: TransformService = {
        handleCompletion: async () => {
          transformCalls += 1;
          return { ok: true, value: { id: "antigravity-ok" } };
        },
      };
      const openaiService = createOpenAIPassthroughService({
        configService: createConfigService(baseUrl),
      });
      const app = createProxyApp({ transformService, openaiService });

      const response = await app.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3-flash",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: "antigravity-ok" });
      expect(transformCalls).toBe(1);
      expect(received).toHaveLength(0);
    } finally {
      server.stop();
    }
  });

  it("routes GPT models to OpenAI passthrough", async () => {
    const { server, baseUrl, received } = await startUpstreamServer();
    try {
      let transformCalls = 0;
      const transformService: TransformService = {
        handleCompletion: async () => {
          transformCalls += 1;
          return { ok: true, value: { id: "antigravity-ok" } };
        },
      };
      const openaiService = createOpenAIPassthroughService({
        configService: createConfigService(baseUrl),
      });
      const app = createProxyApp({ transformService, openaiService });

      const response = await app.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: "upstream-ok" });
      expect(transformCalls).toBe(0);
      expect(received).toHaveLength(1);
      expect(received[0].url).toBe(`${baseUrl}/v1/chat/completions`);
    } finally {
      server.stop();
    }
  });

  it("forwards client Authorization when API key is missing", async () => {
    const { server, baseUrl, received } = await startUpstreamServer();
    try {
      const transformService: TransformService = {
        handleCompletion: async () => ({ ok: true, value: { id: "unused" } }),
      };
      const openaiService = createOpenAIPassthroughService({
        configService: createConfigService(baseUrl),
      });
      const app = createProxyApp({ transformService, openaiService });

      await app.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer client-key",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(received).toHaveLength(1);
      expect(received[0].authorization).toBe("Bearer client-key");
    } finally {
      server.stop();
    }
  });

  it("overrides client Authorization when API key is configured", async () => {
    const { server, baseUrl, received } = await startUpstreamServer();
    try {
      const transformService: TransformService = {
        handleCompletion: async () => ({ ok: true, value: { id: "unused" } }),
      };
      const openaiService = createOpenAIPassthroughService({
        configService: createConfigService(baseUrl, "server-key"),
      });
      const app = createProxyApp({ transformService, openaiService });

      await app.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer client-key",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(received).toHaveLength(1);
      expect(received[0].authorization).toBe("Bearer server-key");
    } finally {
      server.stop();
    }
  });

  it("routes after alias resolution and forwards the resolved model", async () => {
    const { server, baseUrl, received } = await startUpstreamServer();
    try {
      const transformService: TransformService = {
        handleCompletion: async () => ({ ok: true, value: { id: "unused" } }),
      };
      const modelRoutingService: ModelRoutingService = {
        route: (request) => ({
          request: { ...request, model: "gpt-4-turbo" },
          routed: true,
          detectedAlias: "@gpt4",
          originalModel: request.model,
        }),
      };
      const openaiService = createOpenAIPassthroughService({
        configService: createConfigService(baseUrl),
      });
      const app = createProxyApp({
        transformService,
        modelRoutingService,
        openaiService,
      });

      await app.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3-flash",
          messages: [{ role: "user", content: "@gpt4 hello" }],
        }),
      });

      expect(received).toHaveLength(1);
      expect(JSON.parse(received[0].body).model).toBe("gpt-4-turbo");
    } finally {
      server.stop();
    }
  });
});
