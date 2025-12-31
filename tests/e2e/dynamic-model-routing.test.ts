import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createModelAliasConfigService,
  type ModelAliasConfigService,
} from "../../src/config/model-alias-config-service";
import { createModelRoutingService } from "../../src/proxy/model-routing-service";
import { createProxyApp } from "../../src/proxy/proxy-router";
import type { TransformService } from "../../src/proxy/transform-service";
import type { ChatCompletionRequest } from "../../src/transformer/schema";

type CapturedRequest = {
  request: ChatCompletionRequest | null;
};

type SetupOptions = {
  aliasFileContents?: string;
  aliasConfig?: ModelAliasConfigService;
};

async function setupRoutingApp(options: SetupOptions = {}) {
  let aliasConfig: ModelAliasConfigService;
  let cleanup = async () => {};

  if (options.aliasConfig) {
    aliasConfig = options.aliasConfig;
  } else {
    const tempDir = await mkdtemp(path.join(process.cwd(), ".tmp-routing-e2e-"));
    const aliasFilePath = path.join(tempDir, "model-aliases.json");
    const contents =
      options.aliasFileContents ??
      JSON.stringify({ "@fast": "gemini-3-flash" }, null, 2);
    await writeFile(aliasFilePath, contents);

    const relativeAliasPath = path.relative(process.cwd(), aliasFilePath);
    aliasConfig = await createModelAliasConfigService().loadAliases({
      filePath: relativeAliasPath,
    });

    cleanup = async () => {
      await rm(tempDir, { recursive: true, force: true });
    };
  }

  const modelRoutingService = createModelRoutingService({ aliasConfig });
  const captured: CapturedRequest = { request: null };
  const transformService: TransformService = {
    handleCompletion: async (request) => {
      captured.request = request;
      return { ok: true, value: { id: "resp-routing-e2e" } };
    },
  };

  const app = createProxyApp({
    transformService,
    modelRoutingService,
  });

  return { app, captured, cleanup };
}

describe("E2E: dynamic model routing", () => {
  it("routes to the configured model when an alias is present", async () => {
    const { app, captured, cleanup } = await setupRoutingApp();
    try {
      const response = await app.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3-pro-high",
          messages: [{ role: "user", content: "@fast Hello" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(captured.request?.model).toBe("gemini-3-flash");
    } finally {
      await cleanup();
    }
  });

  it("removes the alias from the prompt content", async () => {
    const { app, captured, cleanup } = await setupRoutingApp();
    try {
      const response = await app.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3-pro-high",
          messages: [{ role: "user", content: "@fast Hello" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(captured.request?.messages[0].content).toBe("Hello");
    } finally {
      await cleanup();
    }
  });

  it("passes through requests without an alias", async () => {
    const { app, captured, cleanup } = await setupRoutingApp();
    try {
      const response = await app.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3-pro-high",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(captured.request?.model).toBe("gemini-3-pro-high");
      expect(captured.request?.messages[0].content).toBe("Hello");
    } finally {
      await cleanup();
    }
  });

  it("passes through requests with unknown aliases", async () => {
    const { app, captured, cleanup } = await setupRoutingApp();
    try {
      const response = await app.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3-pro-high",
          messages: [{ role: "user", content: "@unknown Hello" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(captured.request?.model).toBe("gemini-3-pro-high");
      expect(captured.request?.messages[0].content).toBe("@unknown Hello");
    } finally {
      await cleanup();
    }
  });

  it("passes through when alias config JSON is invalid", async () => {
    const { app, captured, cleanup } = await setupRoutingApp({
      aliasFileContents: "{ invalid-json ",
    });
    try {
      const response = await app.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3-pro-high",
          messages: [{ role: "user", content: "@fast Hello" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(captured.request?.model).toBe("gemini-3-pro-high");
      expect(captured.request?.messages[0].content).toBe("@fast Hello");
    } finally {
      await cleanup();
    }
  });

  it("passes through when routing throws an error", async () => {
    const aliasConfig: ModelAliasConfigService = {
      getTargetModel: () => {
        throw new Error("routing failed");
      },
      hasAlias: () => true,
      listAliases: () => ["@fast"],
      getAll: () => new Map([["@fast", "gemini-3-flash"]]),
    };

    const { app, captured, cleanup } = await setupRoutingApp({ aliasConfig });
    try {
      const response = await app.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3-pro-high",
          messages: [{ role: "user", content: "@fast Hello" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(captured.request?.model).toBe("gemini-3-pro-high");
      expect(captured.request?.messages[0].content).toBe("@fast Hello");
    } finally {
      await cleanup();
    }
  });
});
