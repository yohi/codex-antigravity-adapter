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
      const isStream = body.stream === true;
      const headers = new Headers(originalRequest.headers);
      const apiKey = options.configService.getApiKey();
      headers.delete("Host");
      headers.delete("Content-Length");
      if (apiKey) {
        headers.set("Authorization", `Bearer ${apiKey}`);
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new Error("Upstream request timed out"));
      }, timeoutMs);

      try {
        const response = await fetcher(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (isStream && !response.body) {
          return createOpenAIErrorResponse(
            502,
            "Invalid response format from upstream service",
            "api_error",
            "invalid_response"
          );
        }
        return response;
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

type OpenAIErrorResponse = {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
};

function createOpenAIErrorResponse(
  status: number,
  message: string,
  type: string,
  code: string | null
): Response {
  const payload: OpenAIErrorResponse = {
    error: {
      message,
      type,
      param: null,
      code,
    },
  };
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
