import { describe, expect, it } from "bun:test";

import {
  DEFAULT_FIXED_MODEL_IDS,
  type ModelCatalog,
} from "../../src/config/model-settings-service";
import { createProxyApp } from "../../src/proxy/proxy-router";
import type { TransformService } from "../../src/proxy/transform-service";

function createTransformServiceStub(): TransformService {
  return {
    handleCompletion: async () => ({ ok: true, value: { ok: true } }),
  };
}

function createCatalog(ids: string[]): ModelCatalog {
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

describe("Integration: model catalog DI", () => {
  it("uses the injected model catalog for /v1/models", async () => {
    const catalog = createCatalog(["custom-model"]);
    const app = createProxyApp({
      transformService: createTransformServiceStub(),
      modelCatalog: catalog,
    });

    const response = await app.request("http://localhost/v1/models");
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      object: string;
      data: Array<{ id: string }>;
    };

    expect(payload.object).toBe("list");
    expect(payload.data.map((model) => model.id)).toEqual(["custom-model"]);
  });

  it("falls back to the default catalog when none is provided", async () => {
    const app = createProxyApp({
      transformService: createTransformServiceStub(),
    });

    const response = await app.request("http://localhost/v1/models");
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      object: string;
      data: Array<{ id: string }>;
    };

    expect(payload.object).toBe("list");
    expect(payload.data.map((model) => model.id)).toEqual(DEFAULT_FIXED_MODEL_IDS);
  });
});
