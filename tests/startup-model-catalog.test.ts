import { describe, expect, it } from "bun:test";

import type { ModelCatalog } from "../src/config/model-settings-service";
import type { Logger } from "../src/logging";
import { loadModelCatalog } from "../src/main";

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

function createCatalog(
  ids: string[],
  sources: { fixed: number; file: number; env: number }
): ModelCatalog {
  return {
    models: ids.map((id) => ({
      id,
      object: "model",
      created: 1_700_000_000,
      owned_by: "antigravity",
    })),
    sources,
  };
}

describe("loadModelCatalog", () => {
  it("logs success when model catalog loads without warnings", async () => {
    const { entries, logger } = createTestLogger();
    const catalog = createCatalog(["model-a"], { fixed: 1, file: 0, env: 0 });
    const service = {
      load: async () => catalog,
    };

    const result = await loadModelCatalog({
      logger,
      modelSettingsService: service,
      fixedModelIds: ["fixed-a"],
    });

    expect(result).toEqual(catalog);
    const summary = entries.find(
      (entry) => entry.level === "info" && entry.message === "Model catalog loaded successfully"
    );
    expect(summary).toBeTruthy();
    expect(summary?.context).toMatchObject({
      sources: catalog.sources,
      totalModels: catalog.models.length,
    });
  });

  it("logs partial errors when warnings are emitted", async () => {
    const { entries, logger } = createTestLogger();
    const catalog = createCatalog(["model-b"], { fixed: 0, file: 1, env: 0 });
    const service = {
      load: async (options?: { logger?: Logger }) => {
        options?.logger?.warn("env_parse_failed");
        return catalog;
      },
    };

    const result = await loadModelCatalog({
      logger,
      modelSettingsService: service,
    });

    expect(result).toEqual(catalog);
    const summary = entries.find(
      (entry) =>
        entry.level === "info" &&
        entry.message === "Model catalog loaded with partial errors"
    );
    expect(summary).toBeTruthy();
    const errors = summary?.context?.errors as Array<{ message: string }> | undefined;
    expect(errors?.some((error) => error.message === "env_parse_failed")).toBe(true);
  });

  it("falls back to fixed models when loading throws", async () => {
    const { entries, logger } = createTestLogger();
    const service = {
      load: async () => {
        throw new Error("boom");
      },
    };

    const result = await loadModelCatalog({
      logger,
      modelSettingsService: service,
      fixedModelIds: ["fixed-a", "fixed-b"],
      now: () => 1_700_000_000_000,
    });

    expect(result.sources).toEqual({ fixed: 2, file: 0, env: 0 });
    expect(result.models.map((model) => model.id)).toEqual(["fixed-a", "fixed-b"]);
    const summary = entries.find(
      (entry) =>
        entry.level === "warn" &&
        entry.message === "Model catalog loaded with errors, using fixed models only"
    );
    expect(summary).toBeTruthy();
    expect(summary?.context).toMatchObject({
      sources: { fixed: 2, file: 0, env: 0 },
      totalModels: 2,
    });
  });
});
