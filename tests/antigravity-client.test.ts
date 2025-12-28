import { describe, expect, it } from "bun:test";

import { createAntigravityRequester } from "../src/proxy/antigravity-client";
import type { AntigravityRequest } from "../src/transformer/request";

const baseRequest: AntigravityRequest = {
  body: {
    project: "project-123",
    model: "gemini-3-flash",
    request: { contents: [] },
    userAgent: "antigravity",
    requestId: "req-123",
  },
  headers: {
    Authorization: "Bearer token",
  },
};

describe("Antigravity requester", () => {
  it("uses the streaming endpoint and forwards headers/body", async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetcher: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      captured = { url, init };
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const requester = createAntigravityRequester({
      fetch: fetcher,
      endpoints: ["https://daily.test"],
    });
    const result = await requester(baseRequest, { stream: true });

    expect(result.ok).toBe(true);
    expect(captured?.url).toBe(
      "https://daily.test/v1internal:streamGenerateContent?alt=sse"
    );
    const headers = captured?.init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer token");
    expect(captured?.init?.body).toBe(JSON.stringify(baseRequest.body));
  });

  it("falls back from daily to autopush to prod", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      urls.push(url);
      const status = urls.length < 3 ? 500 : 200;
      return new Response(status === 200 ? "{}" : "failed", { status });
    };

    const requester = createAntigravityRequester({
      fetch: fetcher,
      endpoints: [
        "https://daily.test",
        "https://autopush.test",
        "https://prod.test",
      ],
    });
    const result = await requester(baseRequest, { stream: false });

    expect(result.ok).toBe(true);
    expect(urls).toEqual([
      "https://daily.test/v1internal:generateContent",
      "https://autopush.test/v1internal:generateContent",
      "https://prod.test/v1internal:generateContent",
    ]);
  });

  it("maps rate limit responses to OpenAI-compatible errors", async () => {
    const fetcher: typeof fetch = async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "120" },
      });

    const requester = createAntigravityRequester({
      fetch: fetcher,
      endpoints: ["https://daily.test"],
    });
    const result = await requester(baseRequest, { stream: false });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.statusCode).toBe(429);
      expect(result.error.message).toBe("Rate limit exceeded");
      expect(result.error.retryAfter).toBe("120");
      expect(result.error.upstream).toEqual({
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      });
    }
  });
});
