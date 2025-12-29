import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { createModelSettingsService } from "../../src/config/model-settings-service";
import type { Logger } from "../../src/logging";

type LogEntry = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
};

function createTestLogger() {
  const entries: LogEntry[] = [];
  const logger: Logger = {
    debug: (message, context) => entries.push({ level: "debug", message, context }),
    info: (message, context) => entries.push({ level: "info", message, context }),
    warn: (message, context) => entries.push({ level: "warn", message, context }),
    error: (message, context) => entries.push({ level: "error", message, context }),
  };

  return { entries, logger };
}

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
    const tempDir = await mkdtemp(
      path.join(process.cwd(), ".tmp-antigravity-models-")
    );
    const filePath = path.join(tempDir, "custom-models.json");
    const relativeFilePath = path.relative(process.cwd(), filePath);
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
        customModelPaths: [relativeFilePath],
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

  it("parses CSV env models without warnings", async () => {
    process.env.ANTIGRAVITY_ADDITIONAL_MODELS = " model-a , model-b ";
    const { entries, logger } = createTestLogger();

    const service = createModelSettingsService();
    const catalog = await service.load({
      fixedModelIds: [],
      logger,
      now: () => 1_700_000_222_000,
    });

    expect(catalog.models.map((model) => model.id)).toEqual(["model-a", "model-b"]);
    expect(entries.filter((entry) => entry.level === "warn")).toHaveLength(0);
  });

  it("falls back to CSV when JSON parsing fails", async () => {
    process.env.ANTIGRAVITY_ADDITIONAL_MODELS = "[invalid]";
    const { entries, logger } = createTestLogger();

    const service = createModelSettingsService();
    const catalog = await service.load({
      fixedModelIds: [],
      logger,
      now: () => 1_700_000_333_000,
    });

    expect(catalog.models.map((model) => model.id)).toEqual(["[invalid]"]);
    expect(entries.some((entry) => entry.level === "warn")).toBe(true);
  });
});
