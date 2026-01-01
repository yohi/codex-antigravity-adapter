import { describe, expect, it, mock } from "bun:test";
import { createOpenAIConfigService } from "../../src/config/openai-config-service";
import { createOpenAIPassthroughService } from "../../src/proxy/openai-passthrough-service";
import type { ChatCompletionRequest } from "../../src/transformer/schema";

describe("OpenAIPassthroughService", () => {
  const mockRequest: ChatCompletionRequest = {
    model: "gpt-4",
    messages: [{ role: "user", content: "Hello" }],
  };

  it("should use configured API key", async () => {
    const configService = createOpenAIConfigService({
      env: { OPENAI_API_KEY: "sk-server-key" },
    });
    
    let capturedHeaders: Headers | undefined;
    const mockFetch = mock(async (url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ id: "resp-1" }), { status: 200 });
    });

    const service = createOpenAIPassthroughService({
      configService,
      fetch: mockFetch as unknown as typeof fetch,
    });

    await service.handleCompletion(mockRequest, {
      Authorization: "Bearer sk-client-key",
    });

    expect(capturedHeaders?.get("Authorization")).toBe("Bearer sk-server-key");
  });

  it("should pass through client API key when not configured", async () => {
    const configService = createOpenAIConfigService({
      env: {}, // No key
    });

    let capturedHeaders: Headers | undefined;
    const mockFetch = mock(async (url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ id: "resp-1" }), { status: 200 });
    });

    const service = createOpenAIPassthroughService({
      configService,
      fetch: mockFetch as unknown as typeof fetch,
    });

    await service.handleCompletion(mockRequest, {
      Authorization: "Bearer sk-client-key",
    });

    expect(capturedHeaders?.get("Authorization")).toBe("Bearer sk-client-key");
  });

  it("should use configured base URL", async () => {
    const configService = createOpenAIConfigService({
        env: { OPENAI_BASE_URL: "https://my-proxy.com" },
    });
    
    const mockFetch = mock(async () => new Response(JSON.stringify({}), { status: 200 }));
    const service = createOpenAIPassthroughService({
        configService,
        fetch: mockFetch as unknown as typeof fetch,
    });

    await service.handleCompletion(mockRequest, {});
    
    expect(mockFetch).toHaveBeenCalledWith(
        "https://my-proxy.com/v1/chat/completions",
        expect.anything()
    );
  });

  it("should remove Host and Content-Length headers", async () => {
    const configService = createOpenAIConfigService({ env: {} });
    let capturedHeaders: Headers | undefined;
    const mockFetch = mock(async (url, init) => {
        capturedHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({}), { status: 200 });
    });

    const service = createOpenAIPassthroughService({ configService, fetch: mockFetch as unknown as typeof fetch });
    await service.handleCompletion(mockRequest, {
        "Host": "localhost",
        "Content-Length": "123",
        "X-Custom": "custom-value"
    });

    expect(capturedHeaders?.has("Host")).toBe(false);
    expect(capturedHeaders?.has("Content-Length")).toBe(false);
    expect(capturedHeaders?.get("X-Custom")).toBe("custom-value");
  });

  it("should handle upstream error (401)", async () => {
      const configService = createOpenAIConfigService({ env: {} });
      const errorBody = {
          error: {
              message: "Invalid Key",
              type: "invalid_request_error",
              code: "invalid_api_key"
          }
      };
      const mockFetch = mock(async () => new Response(JSON.stringify(errorBody), { status: 401 }));
      const service = createOpenAIPassthroughService({ configService, fetch: mockFetch as unknown as typeof fetch });

      const result = await service.handleCompletion(mockRequest, {});
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
          expect(result.error.statusCode).toBe(401);
          expect(result.error.code).toBe("UPSTREAM_ERROR");
          expect((result.error.upstream as any).code).toBe("invalid_api_key");
      }
  });

  it("should handle network error", async () => {
      const configService = createOpenAIConfigService({ env: {} });
      const mockFetch = mock(async () => { throw new TypeError("Network error"); });
      const service = createOpenAIPassthroughService({ configService, fetch: mockFetch as unknown as typeof fetch });

      const result = await service.handleCompletion(mockRequest, {});
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
          expect(result.error.code).toBe("NETWORK_ERROR");
          expect(result.error.statusCode).toBe(502);
      }
  });

  it("should handle streaming response", async () => {
      const configService = createOpenAIConfigService({ env: {} });
      const stream = new ReadableStream({
          start(controller) {
              controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
              controller.close();
          }
      });
      const mockFetch = mock(async () => new Response(stream, { status: 200 }));
      const service = createOpenAIPassthroughService({ configService, fetch: mockFetch as unknown as typeof fetch });

      const result = await service.handleCompletion({ ...mockRequest, stream: true }, {});
      
      expect(result.ok).toBe(true);
      if (result.ok) {
          expect(result.value).toBeInstanceOf(ReadableStream);
      }
  });
});
