import { describe, expect, it } from "bun:test";
import { createOpenAIConfigService } from "../../src/config/openai-config-service";

describe("OpenAIConfigService", () => {
  it("should return configured API key", () => {
    const service = createOpenAIConfigService({
      env: { OPENAI_API_KEY: "sk-test-key" },
    });
    expect(service.getApiKey()).toBe("sk-test-key");
    expect(service.isConfigured()).toBe(true);
  });

  it("should return undefined when API key is missing", () => {
    const service = createOpenAIConfigService({
      env: {},
    });
    expect(service.getApiKey()).toBeUndefined();
    expect(service.isConfigured()).toBe(false);
  });

  it("should return default base URL", () => {
    const service = createOpenAIConfigService({
      env: {},
    });
    expect(service.getBaseUrl()).toBe("https://api.openai.com");
  });

  it("should return configured base URL", () => {
    const service = createOpenAIConfigService({
      env: { OPENAI_BASE_URL: "https://custom.openai.com" },
    });
    expect(service.getBaseUrl()).toBe("https://custom.openai.com");
  });
});
