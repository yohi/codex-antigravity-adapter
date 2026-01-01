import type { OpenAIConfigService } from "../config/openai-config-service";

export type OpenAIPassthroughService = {
  handleCompletion: (
    originalRequest: Request,
    body: Record<string, unknown>
  ) => Promise<Response>;
};

export type CreateOpenAIPassthroughServiceOptions = {
  configService: OpenAIConfigService;
  fetch?: typeof fetch;
  timeout?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

export function createOpenAIPassthroughService(
  options: CreateOpenAIPassthroughServiceOptions
): OpenAIPassthroughService {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;

  return {
    async handleCompletion(originalRequest, body) {
      const baseUrl = options.configService.getBaseUrl();
      const url = new URL(CHAT_COMPLETIONS_PATH, baseUrl).toString();
      const headers = new Headers(originalRequest.headers);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new Error("Upstream request timed out"));
      }, timeoutMs);

      try {
        return await fetcher(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
