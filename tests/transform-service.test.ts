import { describe, expect, it } from "bun:test";

import { createTransformService } from "../src/proxy/transform-service";
import type { AntigravityRequest } from "../src/transformer/request";
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

describe("TransformService", () => {
  const baseRequest: ChatCompletionRequest = {
    model: "gemini-3-flash",
    messages: [{ role: "user", content: "Hello" }],
  };

  it("returns UNAUTHORIZED when tokens require reauth", async () => {
    let requesterCalled = false;
    const service = createTransformService({
      tokenStore: {
        getAccessToken: async () => ({
          ok: false,
          error: { requiresReauth: true, message: "Missing token" },
        }),
      },
      requester: async () => {
        requesterCalled = true;
        return { ok: true, value: { ok: true } };
      },
    });

    const result = await service.handleCompletion(baseRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHORIZED");
      expect(result.error.statusCode).toBe(401);
      expect(result.error.message).toBe(
        "Authentication required. Please visit http://localhost:51121/login to sign in."
      );
    }
    expect(requesterCalled).toBe(false);
  });

  it("returns TRANSFORM_ERROR when request transformation fails", async () => {
    const service = createTransformService({
      tokenStore: {
        getAccessToken: async () => ({
          ok: true,
          value: { accessToken: "token", projectId: "project-id" },
        }),
      },
      requester: async () => ({ ok: true, value: { ok: true } }),
      createAntigravityRequest: () => ({
        ok: false,
        error: {
          code: "INVALID_MESSAGE_FORMAT",
          message: "Invalid message format",
          field: "messages",
        },
      }),
    });

    const result = await service.handleCompletion(baseRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFORM_ERROR");
      expect(result.error.statusCode).toBe(400);
      expect(result.error.message).toBe("Invalid message format");
    }
  });

  it("builds the Antigravity request with tokens and request ID", async () => {
    let captured: AntigravityRequest | null = null;
    let capturedStream: boolean | null = null;
    const upstreamPayload =
      "data: " +
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
      requester: async (request, options) => {
        captured = request;
        capturedStream = options.stream;
        return { ok: true, value: new Response(upstreamStream) };
      },
      requestIdFactory: () => "req-123",
    });

    const result = await service.handleCompletion({
      ...baseRequest,
      stream: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value).toBeInstanceOf(ReadableStream);
    const output = await readStream(result.value as ReadableStream<Uint8Array>);
    const events = parseSseEvents(output);
    expect(events).toHaveLength(2);
    const first = JSON.parse(events[0]) as {
      id: string;
      object: string;
      created: number;
      model: string;
      choices: Array<{
        index: number;
        delta: { role?: string; content?: string };
        finish_reason: string | null;
      }>;
    };
    expect(first.id).toBe("chatcmpl-req-123");
    expect(first.object).toBe("chat.completion.chunk");
    expect(first.model).toBe("gemini-3-flash");
    expect(typeof first.created).toBe("number");
    expect(first.choices[0].delta.role).toBe("assistant");
    expect(first.choices[0].delta.content).toBe("Hello");
    expect(first.choices[0].finish_reason).toBe("stop");
    expect(events[1]).toBe("[DONE]");

    expect(captured?.body.project).toBe("project-id");
    expect(captured?.body.model).toBe("gemini-3-flash");
    expect(captured?.body.requestId).toBe("req-123");
    expect(captured?.headers.Authorization).toBe("Bearer token");
    expect(captured?.headers.Accept).toBe("text/event-stream");
    expect(capturedStream).toBe(true);
  });

  it("returns transformed response for non-streaming requests", async () => {
    const upstreamPayload = {
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
      usageMetadata: {
        promptTokenCount: 2,
        candidatesTokenCount: 3,
        totalTokenCount: 5,
      },
    };

    const service = createTransformService({
      tokenStore: {
        getAccessToken: async () => ({
          ok: true,
          value: { accessToken: "token", projectId: "project-id" },
        }),
      },
      requester: async () =>
        ({
          ok: true,
          value: new Response(JSON.stringify(upstreamPayload), {
            headers: { "Content-Type": "application/json" },
          }),
        }) as const,
      requestIdFactory: () => "req-456",
    });

    const result = await service.handleCompletion(baseRequest);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const value = result.value as {
      id: string;
      object: string;
      created: number;
      model: string;
      choices: Array<{
        index: number;
        message: { role: string; content: string | null };
        finish_reason: string | null;
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    expect(value.id).toBe("chatcmpl-req-456");
    expect(value.object).toBe("chat.completion");
    expect(typeof value.created).toBe("number");
    expect(value.model).toBe("gemini-3-flash");
    expect(value.choices[0].message.role).toBe("assistant");
    expect(value.choices[0].message.content).toBe("Hello");
    expect(value.choices[0].finish_reason).toBe("stop");
    expect(value.usage).toEqual({
      prompt_tokens: 2,
      completion_tokens: 3,
      total_tokens: 5,
    });
  });

  it("returns UPSTREAM_ERROR when streaming response body is missing", async () => {
    const service = createTransformService({
      tokenStore: {
        getAccessToken: async () => ({
          ok: true,
          value: { accessToken: "token", projectId: "project-id" },
        }),
      },
      requester: async () => ({ ok: true, value: new Response(null) }),
      requestIdFactory: () => "req-404",
    });

    const result = await service.handleCompletion({
      ...baseRequest,
      stream: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("UPSTREAM_ERROR");
    expect(result.error.statusCode).toBe(502);
    expect(result.error.message).toBe("Upstream response body is missing.");
  });
});
