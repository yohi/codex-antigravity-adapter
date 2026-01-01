export type OpenAIConfigService = {
  getApiKey: () => string | undefined;
  getBaseUrl: () => string;
  isConfigured: () => boolean;
};

export type OpenAIConfigServiceOptions = {
  env?: Record<string, string | undefined>;
};

export function createOpenAIConfigService(
  options: OpenAIConfigServiceOptions = {}
): OpenAIConfigService {
  const env = options.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY;
  const baseUrl = env.OPENAI_BASE_URL || "https://api.openai.com";

  return {
    getApiKey: () => apiKey,
    getBaseUrl: () => baseUrl,
    isConfigured: () => !!apiKey,
  };
}
