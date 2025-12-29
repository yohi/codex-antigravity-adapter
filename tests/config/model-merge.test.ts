import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createModelSettingsService } from "../../src/config/model-settings-service";

async function createTempModelsFile(models: string[]): Promise<{
  dir: string;
  filePath: string;
}> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "antigravity-models-"));
  const filePath = path.join(dir, "custom-models.json");
  await writeFile(filePath, JSON.stringify({ models }), "utf8");
  return { dir, filePath };
}

describe("Model merge algorithm", () => {
  const originalEnv = process.env.ANTIGRAVITY_ADDITIONAL_MODELS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ANTIGRAVITY_ADDITIONAL_MODELS;
    } else {
      process.env.ANTIGRAVITY_ADDITIONAL_MODELS = originalEnv;
    }
  });

  it("dedupes IDs across sources with first-seen wins", async () => {
    process.env.ANTIGRAVITY_ADDITIONAL_MODELS = JSON.stringify([
      "shared",
      "env-only",
      "shared",
    ]);
    const { dir, filePath } = await createTempModelsFile([
      "file-only",
      "shared",
      "file-only",
    ]);

    try {
      const service = createModelSettingsService();
      const catalog = await service.load({
        fixedModelIds: ["shared", "fixed-only"],
        customModelPaths: [filePath],
        now: () => 1_700_000_000_000,
        skipPathSafetyCheck: true,
      });

      expect(catalog.models.map((model) => model.id)).toEqual([
        "shared",
        "env-only",
        "file-only",
        "fixed-only",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("respects priority env > file > fixed for overlapping IDs", async () => {
    process.env.ANTIGRAVITY_ADDITIONAL_MODELS = JSON.stringify([
      "shared",
      "env-only",
    ]);
    const { dir, filePath } = await createTempModelsFile([
      "shared",
      "file-only",
    ]);

    try {
      const service = createModelSettingsService();
      const catalog = await service.load({
        fixedModelIds: ["shared", "fixed-only"],
        customModelPaths: [filePath],
        now: () => 1_700_000_000_000,
        skipPathSafetyCheck: true,
      });

      expect(catalog.models.map((model) => model.id)).toEqual([
        "shared",
        "env-only",
        "file-only",
        "fixed-only",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a stable merge order based on first occurrences", async () => {
    process.env.ANTIGRAVITY_ADDITIONAL_MODELS = JSON.stringify([
      "env-b",
      "env-a",
      "env-b",
    ]);
    const { dir, filePath } = await createTempModelsFile([
      "env-a",
      "file-a",
      "file-b",
      "file-a",
    ]);

    try {
      const service = createModelSettingsService();
      const catalog = await service.load({
        fixedModelIds: ["file-b", "fixed-a"],
        customModelPaths: [filePath],
        now: () => 1_700_000_000_000,
        skipPathSafetyCheck: true,
      });

      expect(catalog.models.map((model) => model.id)).toEqual([
        "env-b",
        "env-a",
        "file-a",
        "file-b",
        "fixed-a",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
