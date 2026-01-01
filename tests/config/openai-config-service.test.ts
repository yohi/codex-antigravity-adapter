import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createOpenAIConfigService } from "../../src/config/openai-config-service";

describe("OpenAIConfigService", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    originalEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    originalEnv.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
  });

  afterEach(() => {
    if (originalEnv.OPENAI_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    }

    if (originalEnv.OPENAI_BASE_URL === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL;
    }
  });

  it("returns configured API key and reports configured when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.OPENAI_BASE_URL;

    const service = createOpenAIConfigService();

    expect(service.getApiKey()).toBe("test-key");
    expect(service.isConfigured()).toBe(true);
  });

  it("reports not configured when OPENAI_API_KEY is missing", () => {
    delete process.env.OPENAI_API_KEY;

    const service = createOpenAIConfigService();

    expect(service.getApiKey()).toBeUndefined();
    expect(service.isConfigured()).toBe(false);
  });

  it("returns default base URL when OPENAI_BASE_URL is missing", () => {
    delete process.env.OPENAI_BASE_URL;

    const service = createOpenAIConfigService();

    expect(service.getBaseUrl()).toBe("https://api.openai.com");
  });

  it("returns configured base URL when OPENAI_BASE_URL is set", () => {
    process.env.OPENAI_BASE_URL = "https://example.test";

    const service = createOpenAIConfigService();

    expect(service.getBaseUrl()).toBe("https://example.test");
  });
});
