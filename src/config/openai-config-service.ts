export interface OpenAIConfigService {
  getApiKey(): string | undefined;
  getBaseUrl(): string;
  isConfigured(): boolean;
}

const DEFAULT_BASE_URL = "https://api.openai.com";

export function createOpenAIConfigService(): OpenAIConfigService {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;

  return {
    getApiKey(): string | undefined {
      return apiKey;
    },
    getBaseUrl(): string {
      return baseUrl;
    },
    isConfigured(): boolean {
      return Boolean(apiKey);
    },
  };
}
