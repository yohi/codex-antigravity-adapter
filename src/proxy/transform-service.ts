import { randomUUID } from "node:crypto";

import {
  buildAntigravityRequest,
  transformRequestBasics,
  type AntigravityRequest,
  type TransformError as RequestTransformError,
  type TransformResult as RequestTransformResult,
} from "../transformer/request";
import { SESSION_ID } from "../transformer/helpers";
import {
  transformSingle,
  transformStream,
  type AntigravityResponse,
  type TransformError as ResponseTransformError,
} from "../transformer/response";
import type { ChatCompletionRequest } from "../transformer/schema";

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type ProxyTokens = {
  accessToken: string;
  projectId: string;
};

export type ProxyError = {
  code: "UNAUTHORIZED" | "TRANSFORM_ERROR" | "UPSTREAM_ERROR" | "NETWORK_ERROR";
  message: string;
  statusCode: number;
  upstream?: unknown;
  retryAfter?: string;
};

export type TokenStore = {
  getAccessToken: () => Promise<
    | { ok: true; value: ProxyTokens }
    | { ok: false; error: { requiresReauth: boolean; message: string } }
  >;
};

export type AntigravityRequester = (
  request: AntigravityRequest,
  options: { stream: boolean }
) => Promise<Result<unknown, ProxyError>>;

export type CreateTransformServiceOptions = {
  tokenStore: TokenStore;
  requester: AntigravityRequester;
  requestIdFactory?: () => string;
  createAntigravityRequest?: (
    request: ChatCompletionRequest,
    tokens: ProxyTokens,
    requestId: string
  ) => RequestTransformResult<AntigravityRequest>;
};

export type TransformService = {
  handleCompletion: (
    request: ChatCompletionRequest
  ) => Promise<Result<unknown, ProxyError>>;
};

const AUTH_LOGIN_URL = "http://localhost:51121/login";

export function createTransformService(
  options: CreateTransformServiceOptions
): TransformService {
  const requestIdFactory = options.requestIdFactory ?? (() => randomUUID());
  const createAntigravityRequest =
    options.createAntigravityRequest ?? defaultCreateAntigravityRequest;

  return {
    handleCompletion: async (request) => {
      const tokensResult = await options.tokenStore.getAccessToken();
      if (!tokensResult.ok) {
        return { ok: false, error: mapTokenError(tokensResult.error) };
      }

      const stream = Boolean(request.stream);
      const requestId = requestIdFactory();
      const transformResult = createAntigravityRequest(
        request,
        tokensResult.value,
        requestId
      );
      if (!transformResult.ok) {
        return { ok: false, error: mapTransformError(transformResult.error) };
      }

      try {
        const upstream = await options.requester(transformResult.value, {
          stream,
        });
        if (!upstream.ok) {
          return upstream;
        }
        if (!stream) {
          if (!(upstream.value instanceof Response)) {
            return {
              ok: false,
              error: {
                code: "UPSTREAM_ERROR",
                statusCode: 502,
                message: "Upstream response is invalid.",
              },
            };
          }
          let payload: unknown;
          try {
            payload = await upstream.value.json();
          } catch (error) {
            return {
              ok: false,
              error: {
                code: "UPSTREAM_ERROR",
                statusCode: 502,
                message: "Failed to parse upstream response.",
                upstream: error,
              },
            };
          }

          const upstreamError = extractUpstreamError(payload);
          if (upstreamError) {
            return {
              ok: false,
              error: {
                code: "UPSTREAM_ERROR",
                statusCode: 502,
                message: upstreamError.message,
                upstream: upstreamError,
              },
            };
          }

          const responsePayload = extractResponsePayload(payload);
          if (!responsePayload) {
            return {
              ok: false,
              error: {
                code: "UPSTREAM_ERROR",
                statusCode: 502,
                message: "Upstream response payload is missing.",
              },
            };
          }

          const transformed = transformSingle(
            responsePayload,
            requestId,
            SESSION_ID
          );
          if (!transformed.ok) {
            return { ok: false, error: mapResponseTransformError(transformed.error) };
          }
          return { ok: true, value: transformed.value };
        }
        if (!(upstream.value instanceof Response)) {
          return {
            ok: false,
            error: {
              code: "UPSTREAM_ERROR",
              statusCode: 502,
              message: "Upstream response is invalid.",
            },
          };
        }
        if (!upstream.value.body) {
          return {
            ok: false,
            error: {
              code: "UPSTREAM_ERROR",
              statusCode: 502,
              message: "Upstream response body is missing.",
            },
          };
        }
        return {
          ok: true,
          value: transformStream(upstream.value.body, requestId, SESSION_ID),
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "NETWORK_ERROR",
            statusCode: 502,
            message:
              error instanceof Error
                ? error.message
                : "Failed to reach upstream service.",
            upstream: error,
          },
        };
      }
    },
  };
}

function defaultCreateAntigravityRequest(
  request: ChatCompletionRequest,
  tokens: ProxyTokens,
  requestId: string
): RequestTransformResult<AntigravityRequest> {
  const payloadResult = transformRequestBasics(request);
  if (!payloadResult.ok) {
    return payloadResult;
  }

  const antigravityRequest = buildAntigravityRequest(payloadResult.value, {
    accessToken: tokens.accessToken,
    projectId: tokens.projectId,
    requestId,
    stream: Boolean(request.stream),
  });

  return { ok: true, value: antigravityRequest };
}

function mapTokenError(error: { requiresReauth: boolean; message: string }): ProxyError {
  if (error.requiresReauth) {
    return {
      code: "UNAUTHORIZED",
      statusCode: 401,
      message: `Authentication required. Please visit ${AUTH_LOGIN_URL} to sign in.`,
    };
  }
  return {
    code: "NETWORK_ERROR",
    statusCode: 500,
    message: error.message || "Failed to load tokens.",
  };
}

function mapTransformError(error: RequestTransformError): ProxyError {
  return {
    code: "TRANSFORM_ERROR",
    statusCode: 400,
    message: error.message,
  };
}

function extractUpstreamError(
  payload: unknown
): { type: string; code: string; message: string } | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (!("error" in payload)) {
    return null;
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return {
      type: "upstream_error",
      code: "upstream_error",
      message: "Upstream error.",
    };
  }
  const message =
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "Upstream error.";
  return {
    type: "upstream_error",
    code: "upstream_error",
    message,
  };
}

function extractResponsePayload(payload: unknown): AntigravityResponse | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if ("response" in payload) {
    const response = (payload as { response?: unknown }).response;
    if (response && typeof response === "object") {
      return response as AntigravityResponse;
    }
  }
  if ("candidates" in payload || "usageMetadata" in payload) {
    return payload as AntigravityResponse;
  }
  return null;
}

function mapResponseTransformError(error: ResponseTransformError): ProxyError {
  const mapped = mapResponseTransformErrorPayload(error);
  const statusCode = mapped.type === "invalid_request_error" ? 400 : 500;
  return {
    code: "UPSTREAM_ERROR",
    statusCode,
    message: mapped.message,
    upstream: {
      type: mapped.type,
      code: mapped.code,
    },
  };
}

function mapResponseTransformErrorPayload(error: ResponseTransformError): {
  type: string;
  code: string;
  message: string;
} {
  switch (error.code) {
    case "INVALID_MESSAGE_FORMAT":
      return {
        type: "invalid_request_error",
        code: "invalid_request",
        message: error.message,
      };
    case "UNSUPPORTED_FEATURE":
      return {
        type: "invalid_request_error",
        code: "unsupported_parameter",
        message: error.message,
      };
    case "SIGNATURE_CACHE_MISS":
      return {
        type: "invalid_request_error",
        code: "signature_required",
        message: error.message,
      };
    default:
      return {
        type: "server_error",
        code: "internal_error",
        message: error.message,
      };
  }
}
