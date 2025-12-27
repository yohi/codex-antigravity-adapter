import { Hono } from "hono";

import { ChatCompletionRequestSchema } from "../transformer/schema";

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

export type ProxyTokenStore = {
  getAccessToken: () => Promise<
    | string
    | null
    | { ok: true; value: { accessToken: string; projectId: string } }
    | { ok: false; error: { requiresReauth: boolean; message: string } }
  >;
};

export type ProxyTransformService = {
  handleCompletion: (
    request: unknown
  ) => Promise<
    | unknown
    | { ok: true; value: unknown }
    | { ok: false; error: { statusCode: number; message: string } }
  >;
};

export type CreateProxyAppOptions = {
  tokenStore: ProxyTokenStore;
  transformService: ProxyTransformService;
};

const DEFAULT_PROXY_PORT = 3000;
const DEFAULT_PROXY_HOSTNAME = "127.0.0.1";
const AUTH_LOGIN_URL = "http://localhost:51121/login";

const FIXED_MODEL_IDS = [
  "gemini-3-pro-high",
  "gemini-3-pro-low",
  "gemini-3-flash",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-thinking",
  "claude-opus-4-5-thinking",
  "gpt-oss-120b-medium",
] as const;

export function createProxyApp(options: CreateProxyAppOptions): Hono {
  const app = new Hono();

  app.post("/v1/chat/completions", async (c) => {
    const tokenResult = normalizeTokenResult(
      await options.tokenStore.getAccessToken()
    );
    if (!tokenResult.ok) {
      if (tokenResult.error.requiresReauth) {
        return c.json(authenticationRequiredError(), 401);
      }
      return c.json(
        {
          error: {
            type: "server_error",
            code: "internal_error",
            message: tokenResult.error.message || "Failed to load tokens.",
          },
        },
        500
      );
    }

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

    const parsed = ChatCompletionRequestSchema.safeParse(payload);
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

    const result = normalizeTransformResult(
      await options.transformService.handleCompletion(parsed.data)
    );
    if (!result.ok) {
      const status = result.error.statusCode || 500;
      return c.json(
        {
          error: {
            type: status >= 500 ? "server_error" : "invalid_request_error",
            code: status >= 500 ? "internal_error" : "invalid_request",
            message: result.error.message,
          },
        },
        status
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
    const created = Math.floor(Date.now() / 1000);
    return c.json(
      {
        object: "list",
        data: FIXED_MODEL_IDS.map((id) => ({
          id,
          object: "model",
          created,
          owned_by: "antigravity",
        })),
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

function authenticationRequiredError() {
  return {
    error: {
      type: "authentication_error",
      code: "invalid_api_key",
      message: `Authentication required. Please visit ${AUTH_LOGIN_URL} to sign in.`,
    },
  };
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== "undefined" && value instanceof ReadableStream;
}

function normalizeTokenResult(
  tokenResult:
    | string
    | null
    | { ok: true; value: { accessToken: string; projectId: string } }
    | { ok: false; error: { requiresReauth: boolean; message: string } }
): { ok: true; value: { accessToken: string; projectId: string } } | { ok: false; error: { requiresReauth: boolean; message: string } } {
  if (tokenResult === null) {
    return {
      ok: false,
      error: { requiresReauth: true, message: "Token is missing" },
    };
  }
  if (typeof tokenResult === "string") {
    return { ok: true, value: { accessToken: tokenResult, projectId: "" } };
  }
  return tokenResult;
}

function normalizeTransformResult(
  result:
    | unknown
    | { ok: true; value: unknown }
    | { ok: false; error: { statusCode: number; message: string } }
): { ok: true; value: unknown } | { ok: false; error: { statusCode: number; message: string } } {
  if (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    typeof (result as { ok?: unknown }).ok === "boolean"
  ) {
    return result as
      | { ok: true; value: unknown }
      | { ok: false; error: { statusCode: number; message: string } };
  }
  return { ok: true, value: result };
}
