import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
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

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function restoreFile(filePath: string, contents: string | undefined): Promise<void> {
  if (contents === undefined) {
    await rm(filePath, { force: true });
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
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
    // OS一時ディレクトリを使用してリポジトリを汚染しない
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "antigravity-models-")
    );
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
        customModelPaths: [filePath], // 絶対パスを直接使用
        now: () => 1_700_000_000_000,
        skipPathSafetyCheck: true, // テストでは絶対パスを許可
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
      customModelPaths: [],
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
      customModelPaths: [],
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
      customModelPaths: [],
      logger,
      now: () => 1_700_000_333_000,
    });

    expect(catalog.models.map((model) => model.id)).toEqual(["[invalid]"]);
    expect(entries.some((entry) => entry.level === "warn")).toBe(true);
  });

  it("prefers ./custom-models.json over .codex/custom-models.json and logs when both exist", async () => {
    const { entries, logger } = createTestLogger();
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "antigravity-models-")
    );

    try {
      const cwdFile = path.join(tempDir, "custom-models.json");
      const codexDir = path.join(tempDir, ".codex");
      const codexFile = path.join(codexDir, "custom-models.json");

      await writeFile(
        cwdFile,
        JSON.stringify({ models: ["cwd-model"] }),
        "utf8"
      );
      await mkdir(codexDir, { recursive: true });
      await writeFile(
        codexFile,
        JSON.stringify({ models: ["codex-model"] }),
        "utf8"
      );

      const service = createModelSettingsService();
      const catalog = await service.load({
        fixedModelIds: [],
        customModelPaths: [cwdFile, codexFile],
        logger,
        now: () => 1_700_000_444_000,
        skipPathSafetyCheck: true,
      });

      expect(catalog.models.map((model) => model.id)).toEqual(["cwd-model"]);
      expect(
        entries.some(
          (entry) =>
            entry.level === "info" &&
            entry.message.includes(`Loaded custom models from ${cwdFile}`)
        )
      ).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("logs info and skips file models when no custom models file is found", async () => {
    const { entries, logger } = createTestLogger();
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "antigravity-models-")
    );

    try {
      const cwdFile = path.join(tempDir, "custom-models.json");
      const codexFile = path.join(tempDir, ".codex", "custom-models.json");

      const service = createModelSettingsService();
      const catalog = await service.load({
        fixedModelIds: ["fixed-model"],
        customModelPaths: [cwdFile, codexFile],
        logger,
        now: () => 1_700_000_555_000,
        skipPathSafetyCheck: true,
      });

      expect(catalog.sources.file).toBe(0);
      expect(catalog.models.map((model) => model.id)).toEqual(["fixed-model"]);
      expect(
        entries.some(
          (entry) =>
            entry.level === "info" &&
            entry.message.includes("Custom models file not found")
        )
      ).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("logs errors and skips file models when custom-models.json is invalid", async () => {
    const { entries, logger } = createTestLogger();
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "antigravity-models-")
    );

    try {
      const cwdFile = path.join(tempDir, "custom-models.json");

      await writeFile(cwdFile, "{bad json", "utf8");

      const service = createModelSettingsService();
      const catalog = await service.load({
        fixedModelIds: ["fixed-model"],
        customModelPaths: [cwdFile],
        logger,
        now: () => 1_700_000_666_000,
        skipPathSafetyCheck: true,
      });

      expect(catalog.sources.file).toBe(0);
      expect(catalog.models.map((model) => model.id)).toEqual(["fixed-model"]);
      expect(
        entries.some(
          (entry) =>
            entry.level === "error" &&
            entry.message.includes("Failed to parse custom models file")
        )
      ).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects symlinked custom models that resolve outside cwd", async () => {
    const { entries, logger } = createTestLogger();
    const cwd = process.cwd();
    const tempDir = await mkdtemp(path.join(cwd, "antigravity-models-"));
    const outsideDir = await mkdtemp(
      path.join(os.tmpdir(), "antigravity-models-outside-")
    );

    try {
      const targetFile = path.join(outsideDir, "custom-models.json");
      await writeFile(
        targetFile,
        JSON.stringify({ models: ["outside-model"] }),
        "utf8"
      );

      const symlinkPath = path.join(tempDir, "custom-models.json");
      await symlink(targetFile, symlinkPath);

      const service = createModelSettingsService();
      const catalog = await service.load({
        fixedModelIds: ["fixed-model"],
        customModelPaths: [path.relative(cwd, symlinkPath)],
        logger,
        now: () => 1_700_000_777_000,
      });

      expect(catalog.sources.file).toBe(0);
      expect(catalog.models.map((model) => model.id)).toEqual(["fixed-model"]);
      expect(
        entries.some(
          (entry) =>
            entry.level === "warn" &&
            entry.message.includes("rejecting path outside cwd")
        )
      ).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});
