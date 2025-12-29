import { describe, expect, it } from "bun:test";

import { parseEnvModels } from "../../src/config/model-settings-service";
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

describe("parseEnvModels", () => {
  it("parses JSON array values", () => {
    const { logger } = createTestLogger();

    const models = parseEnvModels('["model-a", "model-b"]', logger);

    expect(models).toEqual(["model-a", "model-b"]);
  });

  it("parses CSV values", () => {
    const { logger } = createTestLogger();

    const models = parseEnvModels(" model-a , model-b ", logger);

    expect(models).toEqual(["model-a", "model-b"]);
  });

  it("falls back to CSV when JSON parsing fails", () => {
    const { entries, logger } = createTestLogger();

    const models = parseEnvModels("[invalid]", logger);

    expect(models).toEqual(["[invalid]"]);
    expect(entries.some((entry) => entry.level === "warn")).toBe(true);
  });

  it("filters empty or whitespace-only IDs", () => {
    const { logger } = createTestLogger();

    const models = parseEnvModels('["", "   ", "model-a", " model-b "]', logger);

    expect(models).toEqual(["model-a", "model-b"]);
  });
});
