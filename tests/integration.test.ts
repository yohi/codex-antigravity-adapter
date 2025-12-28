import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import { OAuthAuthService } from "../src/auth/auth-service";
import { createAuthApp } from "../src/auth/auth-router";
import { InMemoryAuthSessionStore } from "../src/auth/auth-session-store";
import { FileTokenStore } from "../src/auth/token-store";
import type { TokenPair } from "../src/auth/token-store";
import {
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_PROD,
  GOOGLE_OAUTH_TOKEN_URL,
} from "../src/config/antigravity";
import { createProxyApp } from "../src/proxy/proxy-router";
import { createTransformService } from "../src/proxy/transform-service";
import { transformRequestBasics } from "../src/transformer/request";
import { transformSingle } from "../src/transformer/response";
import { SignatureCache, hashThinkingText } from "../src/transformer/helpers";
import type { ChatCompletionRequest } from "../src/transformer/schema";

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

function parseSseEvents(payload: string): string[] {
  return payload
    .split("\n\n")
    .filter((event) => event.trim().length > 0)
    .map((event) => {
      const lines = event.split("\n");
      const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      return dataLines.join("\n");
    })
    .filter((data) => data.length > 0);
}

describe("Integration: OAuth flow", () => {
  it("completes login callback and saves tokens", async () => {
    const saved: TokenPair[] = [];
    const tokenStore = {
      async saveTokens(tokens: TokenPair) {
        saved.push(tokens);
        return { ok: true, value: undefined as void };
      },
      async getAccessToken() {
        if (saved.length === 0) {
          return {
            ok: false,
            error: {
              code: "NOT_FOUND",
              message: "not found",
              requiresReauth: true,
            },
          };
        }
        return {
          ok: true,
          value: {
            accessToken: saved[0].accessToken,
            projectId: saved[0].projectId,
          },
        };
      },
    };
    const sessionStore = new InMemoryAuthSessionStore();
    const fetcher: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === GOOGLE_OAUTH_TOKEN_URL) {
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url === `${ANTIGRAVITY_ENDPOINT_PROD}/v1internal:loadCodeAssist`) {
        return new Response("upstream error", { status: 500 });
      }
      if (url === `${ANTIGRAVITY_ENDPOINT_DAILY}/v1internal:loadCodeAssist`) {
        return new Response(
          JSON.stringify({ cloudaicompanionProject: { id: "project-xyz" } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    };

    const service = new OAuthAuthService({
      tokenStore,
      sessionStore,
      stateSecret: "test-secret",
      fetch: fetcher,
    });
    const app = createAuthApp(service);

    const login = await app.request("http://localhost/login");
    expect(login.status).toBe(302);
    const location = login.headers.get("location");
    expect(location).toBeTruthy();
    const state = new URL(location ?? "").searchParams.get("state");
    expect(state).toBeTruthy();

    const callbackUrl = new URL("http://localhost/oauth-callback");
    callbackUrl.searchParams.set("code", "auth-code");
    callbackUrl.searchParams.set("state", state ?? "");
    const callback = await app.request(callbackUrl.toString());
    expect(callback.status).toBe(200);
    const body = await callback.text();
    expect(body).toContain("Authentication complete");

    expect(saved).toHaveLength(1);
    expect(saved[0].projectId).toBe("project-xyz");

    const statusResponse = await app.request("http://localhost/auth/status");
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toEqual({ authenticated: true });
  });
});

describe("Integration: Proxy flow", () => {
  const baseRequest: ChatCompletionRequest = {
    model: "gemini-3-flash",
    messages: [{ role: "user", content: "Hello" }],
  };

  it("returns OpenAI responses for non-streaming requests", async () => {
    const service = createTransformService({
      tokenStore: {
        getAccessToken: async () => ({
          ok: true,
          value: { accessToken: "token", projectId: "project-id" },
        }),
      },
      requester: async () => ({
        ok: true,
        value: new Response(
          JSON.stringify({
            response: {
              model: "gemini-3-flash",
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [{ text: "Hello" }],
                  },
                  finishReason: "STOP",
                },
              ],
            },
          }),
          { headers: { "Content-Type": "application/json" } }
        ),
      }),
      requestIdFactory: () => "req-integration-1",
    });
    const app = createProxyApp({ transformService: service });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(baseRequest),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.id).toBe("chatcmpl-req-integration-1");
    expect(payload.choices[0].message.content).toBe("Hello");
  });

  it("streams SSE responses end-to-end", async () => {
    const upstreamPayload =
      "data: " +
      JSON.stringify({
        response: {
          model: "gemini-3-flash",
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "Streamed" }],
              },
              finishReason: "STOP",
            },
          ],
        },
      }) +
      "\n\n";
    const upstreamStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(upstreamPayload));
        controller.close();
      },
    });

    const service = createTransformService({
      tokenStore: {
        getAccessToken: async () => ({
          ok: true,
          value: { accessToken: "token", projectId: "project-id" },
        }),
      },
      requester: async () => ({
        ok: true,
        value: new Response(upstreamStream),
      }),
      requestIdFactory: () => "req-integration-2",
    });
    const app = createProxyApp({ transformService: service });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...baseRequest, stream: true }),
    });

    expect(response.status).toBe(200);
    const output = await readStream(response.body as ReadableStream<Uint8Array>);
    const events = parseSseEvents(output);
    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0]).choices[0].delta.content).toBe("Streamed");
    expect(events[1]).toBe("[DONE]");
  });

  it("returns 401 with authentication guidance when unauthenticated", async () => {
    const service = createTransformService({
      tokenStore: {
        getAccessToken: async () => ({
          ok: false,
          error: {
            requiresReauth: true,
            message: "Missing token",
          },
        }),
      },
      requester: async () => ({ ok: true, value: new Response("{}") }),
    });
    const app = createProxyApp({ transformService: service });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(baseRequest),
    });

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.error.message).toContain("http://localhost:51121/login");
  });
});

describe("Integration: Tool flow", () => {
  it("reuses cached signatures between response and request", () => {
    const cache = new SignatureCache({ now: () => 0 });
    const sessionId = "session-tool-flow";
    const signatureBlock = {
      thought: true,
      thoughtSignature: "sig-1",
      thinking: "Plan it",
    };

    const upstreamResponse = {
      model: "claude-sonnet-4-5-thinking",
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              signatureBlock,
              {
                functionCall: {
                  name: "lookup",
                  args: { city: "Tokyo" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };

    const first = transformSingle(upstreamResponse, "req-tool-1", sessionId, {
      signatureCache: cache,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.choices[0].message.tool_calls?.[0].function.name).toBe(
      "lookup"
    );

    const cached = cache.get(sessionId, hashThinkingText("Plan it"));
    expect(cached?.signature).toEqual(signatureBlock);

    const followupRequest = {
      model: "claude-sonnet-4-5-thinking",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Plan it",
              signature: "sig-1",
            },
          ],
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "lookup",
                arguments: "{}",
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-1",
          content: "{\"result\":true}",
        },
      ],
    } as unknown as ChatCompletionRequest;

    const second = transformRequestBasics(followupRequest, {
      signatureCache: cache,
      sessionId,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }

    expect(second.value.request.contents[0].parts[0]).toEqual(signatureBlock);
    expect(second.value.request.contents[0].parts[1]).toEqual({
      functionCall: {
        name: "lookup",
        args: {},
      },
    });
    expect(second.value.request.contents[1]).toEqual({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: "lookup",
            response: { result: true },
          },
        },
      ],
    });
  });
});

describe("Integration: Auth + Proxy domains", () => {
  it("uses the same token store across auth and proxy flows", async () => {
    const tempDir = await mkdtemp(path.join(process.cwd(), ".tmp-integration-"));
    const tokenFilePath = path.join(tempDir, "antigravity-tokens.json");
    const tokenStore = new FileTokenStore({ filePath: tokenFilePath });
    const fetcher: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === GOOGLE_OAUTH_TOKEN_URL) {
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url === `${ANTIGRAVITY_ENDPOINT_PROD}/v1internal:loadCodeAssist`) {
        return new Response("upstream error", { status: 500 });
      }
      if (url === `${ANTIGRAVITY_ENDPOINT_DAILY}/v1internal:loadCodeAssist`) {
        return new Response(
          JSON.stringify({ cloudaicompanionProject: { id: "project-xyz" } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    };

    try {
      const authService = new OAuthAuthService({
        tokenStore,
        sessionStore: new InMemoryAuthSessionStore(),
        stateSecret: "test-secret",
        fetch: fetcher,
      });
      const authApp = createAuthApp(authService);

      const login = await authApp.request("http://localhost/login");
      const location = login.headers.get("location");
      expect(location).toBeTruthy();
      const state = new URL(location ?? "").searchParams.get("state");
      expect(state).toBeTruthy();

      const callbackUrl = new URL("http://localhost/oauth-callback");
      callbackUrl.searchParams.set("code", "auth-code");
      callbackUrl.searchParams.set("state", state ?? "");
      const callback = await authApp.request(callbackUrl.toString());
      expect(callback.status).toBe(200);

      const captured: Array<{ body: { project: string }; headers: Record<string, string> }> = [];
      const service = createTransformService({
        tokenStore,
        requester: async (request) => {
          captured.push({
            body: { project: request.body.project },
            headers: request.headers,
          });
          return {
            ok: true,
            value: new Response(
              JSON.stringify({
                response: {
                  model: "gemini-3-flash",
                  candidates: [
                    {
                      content: {
                        role: "model",
                        parts: [{ text: "Hello" }],
                      },
                      finishReason: "STOP",
                    },
                  ],
                },
              }),
              { headers: { "Content-Type": "application/json" } }
            ),
          };
        },
        requestIdFactory: () => "req-auth-proxy-1",
      });

      const app = createProxyApp({ transformService: service });
      const response = await app.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3-flash",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.id).toBe("chatcmpl-req-auth-proxy-1");
      expect(captured).toHaveLength(1);
      expect(captured[0].body.project).toBe("project-xyz");
      expect(captured[0].headers.Authorization).toBe("Bearer access-token");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("Integration: Error handling", () => {
  it("returns validation errors from the proxy", async () => {
    const app = createProxyApp({
      transformService: {
        handleCompletion: async () => ({ ok: true, value: { ok: true } }),
      },
    });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gemini-3-flash" }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.type).toBe("invalid_request_error");
    expect(payload.error.code).toBe("invalid_request");
  });

  it("maps upstream errors to OpenAI error payloads", async () => {
    const service = createTransformService({
      tokenStore: {
        getAccessToken: async () => ({
          ok: true,
          value: { accessToken: "token", projectId: "project-id" },
        }),
      },
      requester: async () => ({
        ok: true,
        value: new Response(JSON.stringify({ error: { message: "Upstream failed" } }), {
          headers: { "Content-Type": "application/json" },
        }),
      }),
      requestIdFactory: () => "req-error-1",
    });
    const app = createProxyApp({ transformService: service });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-flash",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).toEqual({
      error: {
        type: "upstream_error",
        code: "upstream_error",
        message: "Upstream failed",
      },
    });
  });

  it("returns server errors when the upstream request fails", async () => {
    const service = createTransformService({
      tokenStore: {
        getAccessToken: async () => ({
          ok: true,
          value: { accessToken: "token", projectId: "project-id" },
        }),
      },
      requester: async () => {
        throw new Error("Network down");
      },
    });
    const app = createProxyApp({ transformService: service });

    const response = await app.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemini-3-flash",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).toEqual({
      error: {
        type: "server_error",
        code: "internal_error",
        message: "Network down",
      },
    });
  });
});
