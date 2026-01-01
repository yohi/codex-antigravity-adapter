import type { OpenAIConfigService } from "../config/openai-config-service";
import type { ChatCompletionRequest } from "../transformer/schema";
import type { ProxyError, Result } from "./transform-service";

export type OpenAIPassthroughService = {
  handleCompletion: (
    request: ChatCompletionRequest,
    headers: Record<string, string>
  ) => Promise<Result<unknown, ProxyError>>;
};

export type CreateOpenAIPassthroughServiceOptions = {
  configService: OpenAIConfigService;
  fetch?: typeof fetch;
};

export function createOpenAIPassthroughService(
  options: CreateOpenAIPassthroughServiceOptions
): OpenAIPassthroughService {
  const { configService } = options;
  const fetcher = options.fetch ?? fetch;

  return {
    handleCompletion: async (request, headers) => {
      const apiKey = configService.getApiKey();
      const baseUrl = configService.getBaseUrl();
      const url = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;

      const requestHeaders = new Headers(headers);

      // Handle Authorization
      if (apiKey) {
        requestHeaders.set("Authorization", `Bearer ${apiKey}`);
      }
      // If no API key configured, existing Authorization header from client is preserved (Auth Passthrough)

      // Remove restricted headers
      requestHeaders.delete("Host");
      requestHeaders.delete("Content-Length");
      requestHeaders.delete("Connection"); // Let the fetch client handle connection

      // Ensure Content-Type is set (though usually client sends it)
      if (!requestHeaders.has("Content-Type")) {
        requestHeaders.set("Content-Type", "application/json");
      }

      try {
        const response = await fetcher(url, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify(request),
        });

        // Handle Upstream Errors (4xx, 5xx with body)
        if (!response.ok) {
           // Auth Passthrough mode: 401 from upstream should be passed through
           // Rate limits, etc. also passed through.
           // We try to parse the error body.
           let errorBody: unknown;
           try {
             errorBody = await response.json();
           } catch {
             // If body is not JSON, we return a generic error or the status text
           }

           if (isValidOpenAIError(errorBody)) {
              return {
                ok: false,
                error: {
                  code: "UPSTREAM_ERROR",
                  statusCode: response.status,
                  message: errorBody.error.message || "Upstream error",
                  upstream: errorBody.error,
                  retryAfter: response.headers.get("Retry-After") || undefined,
                }
              }
           }

           // If we can't parse a standard OpenAI error, we construct one.
           return {
             ok: false,
             error: {
               code: "UPSTREAM_ERROR",
               statusCode: response.status,
               message: response.statusText || "Upstream error",
               upstream: {
                  type: "api_error",
                  code: "upstream_error",
                  message: response.statusText
               }
             }
           };
        }

        // Handle Success
        if (request.stream) {
           if (!response.body) {
             return {
                ok: false,
                error: {
                    code: "UPSTREAM_ERROR",
                    statusCode: 502,
                    message: "Upstream response body is missing."
                }
             };
           }
           // Pass the stream directly
           return { ok: true, value: response.body };
        } else {
            // Non-streaming
            try {
                const data = await response.json();
                return { ok: true, value: data };
            } catch (e) {
                return {
                    ok: false,
                    error: {
                        code: "UPSTREAM_ERROR",
                        statusCode: 502,
                        message: "Failed to parse upstream response."
                    }
                };
            }
        }

      } catch (error) {
        // Network errors
        if (error instanceof Error && error.name === 'AbortError') {
             return {
                ok: false,
                error: {
                    code: "NETWORK_ERROR",
                    statusCode: 504,
                    message: "Request timed out",
                }
             };
        }

        return {
          ok: false,
          error: {
            code: "NETWORK_ERROR",
            statusCode: 502, // Bad Gateway for network failures usually
            message: error instanceof Error ? error.message : "Failed to connect to upstream API",
            upstream: error
          },
        };
      }
    },
  };
}

function isValidOpenAIError(body: unknown): body is { error: { message: string; type?: string; code?: string; param?: unknown } } {
  if (!body || typeof body !== "object") return false;
  const err = (body as any).error;
  return err && typeof err === "object";
}
