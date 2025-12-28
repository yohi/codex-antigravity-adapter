import {
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_PROD,
} from "../config/antigravity";
import type { AntigravityRequest } from "../transformer/request";
import type { AntigravityRequester, ProxyError, Result } from "./transform-service";

type CreateAntigravityRequesterOptions = {
  fetch?: typeof fetch;
  endpoints?: string[];
};

type OpenAIErrorShape = {
  type: string;
  code: string;
  message: string;
};

const STREAM_PATH = "/v1internal:streamGenerateContent?alt=sse";
const NON_STREAM_PATH = "/v1internal:generateContent";
const DEFAULT_ENDPOINTS = [
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT_PROD,
];

export function createAntigravityRequester(
  options: CreateAntigravityRequesterOptions = {}
): AntigravityRequester {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const endpoints = options.endpoints ?? DEFAULT_ENDPOINTS;

  return async (
    request: AntigravityRequest,
    requestOptions: { stream: boolean }
  ): Promise<Result<unknown, ProxyError>> => {
    const path = requestOptions.stream ? STREAM_PATH : NON_STREAM_PATH;
    const headers = buildHeaders(request.headers);
    const body = JSON.stringify(request.body);
    let lastError: ProxyError | null = null;

    for (const baseUrl of endpoints) {
      const url = `${baseUrl}${path}`;
      let response: Response;
      try {
        response = await fetcher(url, {
          method: "POST",
          headers,
          body,
        });
      } catch (error) {
        lastError = toNetworkError(error);
        continue;
      }

      if (response.ok) {
        return { ok: true, value: response };
      }

      const mapped = await toUpstreamError(response);
      lastError = mapped;
      if (shouldFallback(response.status)) {
        continue;
      }
      return { ok: false, error: mapped };
    }

    if (lastError) {
      return { ok: false, error: lastError };
    }

    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        statusCode: 502,
        message: "Failed to reach upstream service.",
      },
    };
  };
}

function buildHeaders(baseHeaders: Record<string, string>): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...baseHeaders,
  };
}

function shouldFallback(status: number): boolean {
  return status === 404 || status >= 500;
}

function toNetworkError(error: unknown): ProxyError {
  return {
    code: "NETWORK_ERROR",
    statusCode: 502,
    message:
      error instanceof Error ? error.message : "Failed to reach upstream service.",
    upstream: error,
  };
}

async function toUpstreamError(response: Response): Promise<ProxyError> {
  const statusCode = response.status;
  const retryAfter = response.headers.get("Retry-After") ?? undefined;
  const bodyText = await readResponseText(response);
  const bodyMessage = extractErrorMessage(bodyText);
  const mapped = mapStatusToOpenAIError(statusCode, bodyMessage);

  return {
    code: "UPSTREAM_ERROR",
    statusCode,
    message: mapped.message,
    upstream: {
      type: mapped.type,
      code: mapped.code,
    },
    retryAfter,
  };
}

function mapStatusToOpenAIError(
  status: number,
  message?: string
): OpenAIErrorShape {
  switch (status) {
    case 400:
      return {
        type: "invalid_request_error",
        code: "invalid_request",
        message: message || "Invalid request",
      };
    case 401:
      return {
        type: "authentication_error",
        code: "invalid_api_key",
        message: message || "Authentication failed",
      };
    case 403:
      return {
        type: "permission_denied",
        code: "permission_denied",
        message: "Permission denied",
      };
    case 404:
      return {
        type: "invalid_request_error",
        code: "unknown_model",
        message: "Unknown model",
      };
    case 429:
      return {
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
        message: "Rate limit exceeded",
      };
    default:
      return {
        type: "upstream_error",
        code: "upstream_error",
        message: message || `Upstream error (${status})`,
      };
  }
}

function extractErrorMessage(bodyText?: string): string | undefined {
  if (!bodyText) {
    return undefined;
  }
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    const error = payload.error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
    const topMessage = payload.message;
    if (typeof topMessage === "string" && topMessage.trim()) {
      return topMessage;
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

async function readResponseText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}
