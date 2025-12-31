import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { createModelAliasConfigService, type ModelAliasConfigService } from "../../src/config/model-alias-config-service";
import { createLogger } from "../../src/logging";

// Mock logger
const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
} as any;

describe("ModelAliasConfigService", () => {
  const TEST_FILE_PATH = "model-aliases.test.json";

  afterEach(async () => {
    const file = Bun.file(TEST_FILE_PATH);
    if (await file.exists()) {
      await Bun.write(TEST_FILE_PATH, ""); // Clear content
      await unlink(TEST_FILE_PATH);
    }
  });

  // Helper to delete file
  async function unlink(path: string) {
     // In Bun, we can't easily unlink, but writing empty or just ignoring is fine for temp files if we overwrite them.
     // Actually, let's use a shell command to remove it to be clean.
     const { spawn } = Bun;
     await spawn(["rm", "-f", path]).exited;
  }

  it("should load valid aliases from file", async () => {
    const aliases = {
      "@fast": "gemini-3-flash",
      "@think": "claude-sonnet-4-5-thinking"
    };
    await Bun.write(TEST_FILE_PATH, JSON.stringify(aliases));

    const service = await createModelAliasConfigService().loadAliases({
      filePath: TEST_FILE_PATH,
      logger: mockLogger,
      skipPathSafetyCheck: true // Skip safety check for test file in same dir
    });

    expect(service.getAll().size).toBe(2);
    expect(service.getTargetModel("@fast")).toBe("gemini-3-flash");
    expect(service.getTargetModel("@think")).toBe("claude-sonnet-4-5-thinking");
    expect(service.hasAlias("@fast")).toBe(true);
    expect(service.listAliases()).toEqual(["@fast", "@think"]);
  });

  it("should return empty map if file does not exist", async () => {
    await unlink(TEST_FILE_PATH);

    const service = await createModelAliasConfigService().loadAliases({
      filePath: TEST_FILE_PATH,
      logger: mockLogger,
      skipPathSafetyCheck: true
    });

    expect(service.getAll().size).toBe(0);
    expect(mockLogger.info).toHaveBeenCalled();
  });

  it("should return empty map and warn if file contains invalid JSON", async () => {
    await Bun.write(TEST_FILE_PATH, "{ invalid json }");

    const service = await createModelAliasConfigService().loadAliases({
      filePath: TEST_FILE_PATH,
      logger: mockLogger,
      skipPathSafetyCheck: true
    });

    expect(service.getAll().size).toBe(0);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("should skip invalid entries and warn", async () => {
    const aliases = {
      "@valid": "valid-model",
      "invalid-no-at": "model1",
      "@invalid-char!": "model2",
      "@empty-target": "",
    };
    await Bun.write(TEST_FILE_PATH, JSON.stringify(aliases));

    const service = await createModelAliasConfigService().loadAliases({
      filePath: TEST_FILE_PATH,
      logger: mockLogger,
      skipPathSafetyCheck: true
    });

    expect(service.getAll().size).toBe(1);
    expect(service.hasAlias("@valid")).toBe(true);
    expect(service.hasAlias("invalid-no-at")).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});