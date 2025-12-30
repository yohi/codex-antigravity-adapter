import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createModelAliasConfigService } from "../../src/config/model-alias-config-service";
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

describe("ModelAliasConfigService", () => {
  it("returns an empty alias map by default", async () => {
    const service = await createModelAliasConfigService().loadAliases();

    expect(service.getTargetModel("@fast")).toBeUndefined();
    expect(service.hasAlias("@fast")).toBe(false);
    expect(service.listAliases()).toEqual([]);

    const map = service.getAll();
    expect(map.size).toBe(0);
    expect(map.get("@fast")).toBeUndefined();
  });

  it("loads alias definitions from model-aliases.json", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "antigravity-aliases-"));
    const filePath = path.join(tempDir, "model-aliases.json");

    try {
      await writeFile(
        filePath,
        JSON.stringify({ "@fast": "gemini-3-flash", "@think": "claude-4" }),
        "utf8"
      );

      const service = await createModelAliasConfigService().loadAliases({
        filePath,
        skipPathSafetyCheck: true,
      });

      expect(service.getTargetModel("@fast")).toBe("gemini-3-flash");
      expect(service.hasAlias("@think")).toBe(true);
      expect([...service.listAliases()].sort()).toEqual(["@fast", "@think"].sort());
      expect(service.getAll().size).toBe(2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("logs info and returns empty map when aliases file is missing", async () => {
    const { entries, logger } = createTestLogger();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "antigravity-aliases-"));
    const filePath = path.join(tempDir, "model-aliases.json");

    try {
      const service = await createModelAliasConfigService().loadAliases({
        filePath,
        logger,
        skipPathSafetyCheck: true,
      });

      expect(service.getAll().size).toBe(0);
      expect(
        entries.some(
          (entry) =>
            entry.level === "info" &&
            entry.message.includes("Model aliases file not found")
        )
      ).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("logs warn and returns empty map when aliases file has invalid JSON", async () => {
    const { entries, logger } = createTestLogger();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "antigravity-aliases-"));
    const filePath = path.join(tempDir, "model-aliases.json");

    try {
      await writeFile(filePath, "{bad json", "utf8");

      const service = await createModelAliasConfigService().loadAliases({
        filePath,
        logger,
        skipPathSafetyCheck: true,
      });

      expect(service.getAll().size).toBe(0);
      expect(
        entries.some(
          (entry) =>
            entry.level === "warn" &&
            entry.message.includes("Failed to parse model aliases file")
        )
      ).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("skips invalid alias entries and logs warnings", async () => {
    const { entries, logger } = createTestLogger();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "antigravity-aliases-"));
    const filePath = path.join(tempDir, "model-aliases.json");

    try {
      await writeFile(
        filePath,
        JSON.stringify({
          "@fast": "gemini-3-flash",
          fast: "gemini-3-flash",
          "@empty": "",
          "@bad space": "gemini-3-flash",
          "@badtarget": 42,
        }),
        "utf8"
      );

      const service = await createModelAliasConfigService().loadAliases({
        filePath,
        logger,
        skipPathSafetyCheck: true,
      });

      expect(service.getAll().size).toBe(1);
      expect(service.getTargetModel("@fast")).toBe("gemini-3-flash");
      expect(service.hasAlias("fast")).toBe(false);
      expect(service.hasAlias("@empty")).toBe(false);
      expect(service.hasAlias("@bad space")).toBe(false);
      expect(service.hasAlias("@badtarget")).toBe(false);

      const invalidWarnings = entries.filter(
        (entry) =>
          entry.level === "warn" &&
          entry.message.includes("Invalid model alias entry")
      );
      expect(invalidWarnings.length).toBe(4);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects absolute paths and logs warning", async () => {
    const { entries, logger } = createTestLogger();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "antigravity-aliases-"));
    const filePath = path.join(tempDir, "model-aliases.json");

    try {
      await writeFile(
        filePath,
        JSON.stringify({ "@fast": "gemini-3-flash" }),
        "utf8"
      );

      const service = await createModelAliasConfigService().loadAliases({
        filePath,
        logger,
      });

      expect(service.getAll().size).toBe(0);
      expect(
        entries.some(
          (entry) =>
            entry.level === "warn" &&
            entry.message.includes("unsafe path")
        )
      ).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects paths containing '..' and logs warning", async () => {
    const { entries, logger } = createTestLogger();
    const tempDir = await mkdtemp(path.join(process.cwd(), "antigravity-aliases-"));
    const filePath = path.join(tempDir, "model-aliases.json");
    const relativeDir = path.relative(process.cwd(), tempDir);
    const unsafeRelativePath = `${relativeDir}${path.sep}..${path.sep}${path.basename(
      tempDir
    )}${path.sep}model-aliases.json`;

    try {
      await writeFile(
        filePath,
        JSON.stringify({ "@fast": "gemini-3-flash" }),
        "utf8"
      );

      const service = await createModelAliasConfigService().loadAliases({
        filePath: unsafeRelativePath,
        logger,
      });

      expect(service.getAll().size).toBe(0);
      expect(
        entries.some(
          (entry) =>
            entry.level === "warn" &&
            entry.message.includes("unsafe path")
        )
      ).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects aliases file resolving outside cwd via symlink", async () => {
    if (process.platform === "win32") {
      return;
    }

    const { entries, logger } = createTestLogger();
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "antigravity-aliases-"));
    const targetFilePath = path.join(targetDir, "model-aliases.json");
    const linkDir = await mkdtemp(path.join(process.cwd(), "antigravity-aliases-"));
    const linkPath = path.join(linkDir, "model-aliases.json");
    const relativeLinkPath = path.relative(process.cwd(), linkPath);

    try {
      await writeFile(
        targetFilePath,
        JSON.stringify({ "@fast": "gemini-3-flash" }),
        "utf8"
      );
      await symlink(targetFilePath, linkPath);

      const service = await createModelAliasConfigService().loadAliases({
        filePath: relativeLinkPath,
        logger,
      });

      expect(service.getAll().size).toBe(0);
      expect(
        entries.some(
          (entry) =>
            entry.level === "warn" &&
            entry.message.includes("outside cwd")
        )
      ).toBe(true);
    } finally {
      await rm(linkDir, { recursive: true, force: true });
      await rm(targetDir, { recursive: true, force: true });
    }
  });
});
