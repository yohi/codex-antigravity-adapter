import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createModelSettingsService } from "../../src/config/model-settings-service";
import { createProxyApp } from "../../src/proxy/proxy-router";
import type { TransformService } from "../../src/proxy/transform-service";

function createTransformServiceStub(): TransformService {
  return {
    handleCompletion: async () => ({ ok: true, value: { ok: true } }),
  };
}

describe("Integration: /v1/models", () => {
  const originalEnv = process.env.ANTIGRAVITY_ADDITIONAL_MODELS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ANTIGRAVITY_ADDITIONAL_MODELS;
    } else {
      process.env.ANTIGRAVITY_ADDITIONAL_MODELS = originalEnv;
    }
  });

  it("includes env models in the /v1/models response", async () => {
    process.env.ANTIGRAVITY_ADDITIONAL_MODELS = JSON.stringify([
      "env-model-a",
      "env-model-b",
    ]);

    const service = createModelSettingsService();
    const catalog = await service.load({
      fixedModelIds: ["fixed-model"],
      customModelPaths: [],
      now: () => 1_700_000_000_000,
    });

    const app = createProxyApp({
      transformService: createTransformServiceStub(),
      modelCatalog: catalog,
    });

    const response = await app.request("http://localhost/v1/models");
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      object: string;
      data: Array<{ id: string; object: string }>;
    };

    expect(payload.object).toBe("list");
    expect(payload.data.map((model) => model.id)).toEqual([
      "env-model-a",
      "env-model-b",
      "fixed-model",
    ]);
    expect(payload.data.every((model) => model.object === "model")).toBe(true);
  });

  it("includes file models in the /v1/models response", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "antigravity-models-"));
    const filePath = path.join(tempDir, "custom-models.json");
    await writeFile(filePath, JSON.stringify({ models: ["file-model"] }), "utf8");

    try {
      delete process.env.ANTIGRAVITY_ADDITIONAL_MODELS;
      const service = createModelSettingsService();
      const catalog = await service.load({
        fixedModelIds: ["fixed-model"],
        customModelPaths: [filePath],
        now: () => 1_700_000_000_000,
        skipPathSafetyCheck: true,
      });

      const app = createProxyApp({
        transformService: createTransformServiceStub(),
        modelCatalog: catalog,
      });

      const response = await app.request("http://localhost/v1/models");
      expect(response.status).toBe(200);

      const payload = (await response.json()) as {
        object: string;
        data: Array<{ id: string; object: string }>;
      };

      expect(payload.object).toBe("list");
      expect(payload.data.map((model) => model.id)).toEqual([
        "file-model",
        "fixed-model",
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns fixed models only when env and file settings are invalid", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "antigravity-models-"));
    const filePath = path.join(tempDir, "custom-models.json");
    await writeFile(filePath, "{bad json", "utf8");
    process.env.ANTIGRAVITY_ADDITIONAL_MODELS = "  ,  ,  ";

    try {
      const service = createModelSettingsService();
      const catalog = await service.load({
        fixedModelIds: ["fixed-model-a", "fixed-model-b"],
        customModelPaths: [filePath],
        now: () => 1_700_000_000_000,
        skipPathSafetyCheck: true,
      });

      const app = createProxyApp({
        transformService: createTransformServiceStub(),
        modelCatalog: catalog,
      });

      const response = await app.request("http://localhost/v1/models");
      expect(response.status).toBe(200);

      const payload = (await response.json()) as {
        object: string;
        data: Array<{ id: string; object: string }>;
      };

      expect(payload.object).toBe("list");
      expect(payload.data.map((model) => model.id)).toEqual([
        "fixed-model-a",
        "fixed-model-b",
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
