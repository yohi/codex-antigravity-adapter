import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createModelSettingsService } from "../../src/config/model-settings-service";

describe("ModelSettingsService", () => {
  const originalEnv = process.env.ANTIGRAVITY_ADDITIONAL_MODELS;

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env.ANTIGRAVITY_ADDITIONAL_MODELS;
    } else {
      process.env.ANTIGRAVITY_ADDITIONAL_MODELS = originalEnv;
    }
  });

  it("builds a model catalog from fixed, env, and file sources", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "antigravity-models-"));
    const filePath = path.join(tempDir, "custom-models.json");
    await writeFile(
      filePath,
      JSON.stringify({ models: ["file-model"] }),
      "utf8"
    );
    process.env.ANTIGRAVITY_ADDITIONAL_MODELS = JSON.stringify(["env-model"]);

    try {
      const service = createModelSettingsService();
      const catalog = await service.load({
        fixedModelIds: ["fixed-model"],
        customModelPaths: [filePath],
        now: () => 1_700_000_000_000,
      });

      expect(catalog.sources).toEqual({ fixed: 1, file: 1, env: 1 });
      expect(catalog.models.map((model) => model.id)).toEqual([
        "env-model",
        "file-model",
        "fixed-model",
      ]);
      expect(catalog.models[0]).toEqual({
        id: "env-model",
        object: "model",
        created: 1_700_000_000,
        owned_by: "antigravity",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns a catalog built from fixed models when optional sources are empty", async () => {
    delete process.env.ANTIGRAVITY_ADDITIONAL_MODELS;

    const service = createModelSettingsService();
    const catalog = await service.load({
      fixedModelIds: ["fixed-a", "fixed-b"],
      now: () => 1_700_000_111_000,
    });

    expect(catalog.sources).toEqual({ fixed: 2, file: 0, env: 0 });
    expect(catalog.models).toEqual([
      {
        id: "fixed-a",
        object: "model",
        created: 1_700_000_111,
        owned_by: "antigravity",
      },
      {
        id: "fixed-b",
        object: "model",
        created: 1_700_000_111,
        owned_by: "antigravity",
      },
    ]);
  });
});
