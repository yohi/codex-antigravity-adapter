import { Hono } from "hono";

import {
  DEFAULT_FIXED_MODEL_IDS,
  type ModelCatalog,
} from "../config/model-settings-service";
import type { ModelRoutingService } from "./model-routing-service";
import { ChatCompletionRequestSchema } from "../transformer/schema";
import type { OpenAIPassthroughService } from "./openai-passthrough-service";
import { shouldRouteToOpenAI } from "./route-utils";
import type { ProxyError, TransformService } from "./transform-service";

type ServeOptions = {
  fetch: (request: Request) => Response | Promise<Response>;
  port: number;
  hostname: string;
};

export type ProxyServerOptions = {
  port?: number;
  hostname?: string;
  serve?: (options: ServeOptions) => { stop?: () => void };
};

export type CreateProxyAppOptions = {
  transformService: TransformService;
  modelCatalog?: ModelCatalog;
  modelRoutingService?: ModelRoutingService;
  openaiService?: OpenAIPassthroughService;
};

const DEFAULT_PROXY_PORT = 3000;
const DEFAULT_PROXY_HOSTNAME = "127.0.0.1";

export function createProxyApp(options: CreateProxyAppOptions): Hono {
  const modelCatalog = options.modelCatalog ?? buildDefaultModelCatalog();
  const app = new Hono() as Hono & { modelCatalog: ModelCatalog };
  app.modelCatalog = modelCatalog;

  app.post("/v1/chat/completions", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            type: "invalid_request_error",
            code: "invalid_request",
            message: "Request body must be valid JSON.",
          },
        },
        400
      );
    }

    const payloadRecord = isRecord(payload) ? payload : null;
    const modelValue = payloadRecord?.model;
    if (modelValue === undefined || modelValue === null || modelValue === "") {
      return c.json(
        createOpenAIErrorPayload(
          "Missing required parameter: 'model'",
          "invalid_request_error",
          null,
          "model"
        ),
        400
      );
    }
    if (typeof modelValue !== "string") {
      return c.json(
        {
          error: {
            type: "invalid_request_error",
            code: "invalid_request",
            message: "Invalid 'model' parameter.",
          },
        },
        400
      );
    }
    if (!payloadRecord) {
      return c.json(
        {
          error: {
            type: "invalid_request_error",
            code: "invalid_request",
            message: "Request body must be a JSON object.",
          },
        },
        400
      );
    }

    let routedModel = modelValue;
    let routingResult: ReturnType<ModelRoutingService["route"]> | undefined;
    if (options.modelRoutingService) {
      const candidate = buildRoutingCandidate(payloadRecord);
      const parsedCandidate = ChatCompletionRequestSchema.safeParse(candidate);
      if (parsedCandidate.success) {
        routingResult = options.modelRoutingService.route(parsedCandidate.data);
        routedModel = routingResult.request.model;
      }
    }

    if (shouldRouteToOpenAI(routedModel)) {
      if (!options.openaiService) {
        return c.json(
          createOpenAIErrorPayload(
            "OpenAI passthrough service is not configured.",
            "api_error",
            "router_internal_error"
          ),
          500
        );
      }
      const routedBody =
        routingResult?.routed && routingResult.request.model !== modelValue
          ? { ...payloadRecord, model: routingResult.request.model }
          : payloadRecord;
      return options.openaiService.handleCompletion(c.req.raw, routedBody);
    }

    const parsed = ChatCompletionRequestSchema.safeParse(payloadRecord);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            type: "invalid_request_error",
            code: "invalid_request",
            message: parsed.error.message,
          },
        },
        400
      );
    }

    const antigravityRoutingResult =
      routingResult ?? options.modelRoutingService?.route(parsed.data);
    const routedRequest = antigravityRoutingResult?.request ?? parsed.data;
    const result = normalizeTransformResult(
      await options.transformService.handleCompletion(routedRequest)
    );
    if (!result.ok) {
      const status = result.error.statusCode || 500;
      const mapped = resolveProxyErrorMapping(result.error);
      const headers = result.error.retryAfter
        ? { "Retry-After": result.error.retryAfter }
        : undefined;
      return c.json(
        {
          error: {
            type: mapped.type,
            code: mapped.code,
            message: result.error.message,
          },
        },
        status,
        headers
      );
    }

    if (isReadableStream(result.value)) {
      return new Response(result.value, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    return c.json(result.value, 200);
  });

  app.get("/v1/models", (c) => {
    return c.json(
      {
        object: "list",
        data: modelCatalog.models,
      },
      200
    );
  });

  app.notFound((c) =>
    c.json(
      {
        error: {
          type: "invalid_request_error",
          code: "unknown_endpoint",
          message: "Unknown endpoint",
        },
      },
      404
    )
  );

  app.onError((error, c) => {
    const status = resolveErrorStatus(error);
    const message =
      error instanceof Error ? error.message : "Unexpected error occurred.";
    const isServerError = status >= 500;
    return c.json(
      {
        error: {
          type: isServerError ? "server_error" : "invalid_request_error",
          code: isServerError ? "internal_error" : "invalid_request",
          message,
        },
      },
      status
    );
  });

  return app;
}

export function startProxyServer(app: Hono, options: ProxyServerOptions = {}) {
  const port = options.port ?? DEFAULT_PROXY_PORT;
  const hostname = options.hostname ?? DEFAULT_PROXY_HOSTNAME;
  const serve =
    options.serve ??
    ((serveOptions: ServeOptions) => {
      return Bun.serve(serveOptions);
    });

  return serve({ fetch: app.fetch, port, hostname });
}

function buildDefaultModelCatalog(): ModelCatalog {
  const created = Math.floor(Date.now() / 1000);
  return {
    models: DEFAULT_FIXED_MODEL_IDS.map((id) => ({
      id,
      object: "model",
      created,
      owned_by: "antigravity",
    })),
    sources: {
      fixed: DEFAULT_FIXED_MODEL_IDS.length,
      file: 0,
      env: 0,
    },
  };
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== "undefined" && value instanceof ReadableStream;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProxyError(value: unknown): value is ProxyError {
  if (!isRecord(value)) return false;
  if (typeof value.message !== "string") return false;
  if (typeof value.statusCode !== "number") return false;
  if (typeof value.code !== "string") return false;
  return (
    value.code === "UNAUTHORIZED" ||
    value.code === "TRANSFORM_ERROR" ||
    value.code === "UPSTREAM_ERROR" ||
    value.code === "NETWORK_ERROR"
  );
}

function normalizeTransformResult(
  result:
    | unknown
    | { ok: true; value: unknown }
    | { ok: false; error: ProxyError }
): { ok: true; value: unknown } | { ok: false; error: ProxyError } {
  if (isRecord(result) && "ok" in result && typeof result.ok === "boolean") {
    if (result.ok === true && "value" in result) {
      return { ok: true, value: (result as { value: unknown }).value };
    }

    if (result.ok === false) {
      const error = "error" in result ? (result as { error?: unknown }).error : undefined;
      if (isProxyError(error)) return { ok: false, error };

      if (
        isRecord(error) &&
        typeof error.statusCode === "number" &&
        typeof error.message === "string"
      ) {
        return {
          ok: false,
          error: {
            code: "UPSTREAM_ERROR",
            statusCode: error.statusCode,
            message: error.message,
            upstream: error,
          },
        };
      }

      const message = String(error);
      return {
        ok: false,
        error: {
          code: "UPSTREAM_ERROR",
          statusCode: 502,
          message: message ? message : "Unknown error",
          upstream: error,
        },
      };
    }
  }
  return { ok: true, value: result };
}

type OpenAIErrorPayload = {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
};

function createOpenAIErrorPayload(
  message: string,
  type: string,
  code: string | null,
  param: string | null = null
): OpenAIErrorPayload {
  return {
    error: {
      message,
      type,
      param,
      code,
    },
  };
}

function mapProxyError(error: ProxyError): { type: string; code: string } {
  switch (error.code) {
    case "UNAUTHORIZED":
      return { type: "authentication_error", code: "invalid_api_key" };
    case "UPSTREAM_ERROR":
      return { type: "upstream_error", code: "upstream_error" };
    case "NETWORK_ERROR":
      return { type: "server_error", code: "internal_error" };
    case "TRANSFORM_ERROR":
      return { type: "invalid_request_error", code: "invalid_request" };
    default:
      return {
        type: error.statusCode >= 500 ? "server_error" : "invalid_request_error",
        code: error.statusCode >= 500 ? "internal_error" : "invalid_request",
      };
  }
}

function resolveProxyErrorMapping(error: ProxyError): { type: string; code: string } {
  const upstream = extractUpstreamMapping(error.upstream);
  if (upstream) {
    return upstream;
  }
  return mapProxyError(error);
}

function extractUpstreamMapping(
  upstream: ProxyError["upstream"]
): { type: string; code: string } | null {
  if (!upstream || typeof upstream !== "object") {
    return null;
  }
  const mapped = upstream as { type?: unknown; code?: unknown };
  if (typeof mapped.type === "string" && typeof mapped.code === "string") {
    return { type: mapped.type, code: mapped.code };
  }
  return null;
}

function resolveErrorStatus(error: unknown): number {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return status;
    }
  }
  return 500;
}

function buildRoutingCandidate(
  payload: Record<string, unknown>
): Record<string, unknown> {
  return {
    model: payload.model,
    messages: payload.messages,
    tools: payload.tools,
    tool_choice: payload.tool_choice,
    stream: payload.stream,
    temperature: payload.temperature,
    max_tokens: payload.max_tokens,
    n: payload.n,
    logprobs: payload.logprobs,
  };
}
