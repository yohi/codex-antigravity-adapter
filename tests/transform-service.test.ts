import { describe, expect, it } from "bun:test";

import { createTransformService } from "../src/proxy/transform-service";
import type { AntigravityRequest } from "../src/transformer/request";
import type { ChatCompletionRequest } from "../src/transformer/schema";

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
        return { ok: true, value: { id: "response-1" } };
      },
      requestIdFactory: () => "req-123",
    });

    const result = await service.handleCompletion({
      ...baseRequest,
      stream: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ id: "response-1" });
    }

    expect(captured?.body.project).toBe("project-id");
    expect(captured?.body.model).toBe("gemini-3-flash");
    expect(captured?.body.requestId).toBe("req-123");
    expect(captured?.headers.Authorization).toBe("Bearer token");
    expect(captured?.headers.Accept).toBe("text/event-stream");
    expect(capturedStream).toBe(true);
  });
});
