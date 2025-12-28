import { randomUUID } from "node:crypto";

import {
  buildAntigravityRequest,
  transformRequestBasics,
  type AntigravityRequest,
  type TransformError as RequestTransformError,
  type TransformResult as RequestTransformResult,
} from "../transformer/request";
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
        return await options.requester(transformResult.value, {
          stream: Boolean(request.stream),
        });
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
