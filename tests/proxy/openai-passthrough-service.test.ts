import { describe, expect, it } from "bun:test";

import type { OpenAIConfigService } from "../../src/config/openai-config-service";
import { createOpenAIPassthroughService } from "../../src/proxy/openai-passthrough-service";

function createConfigService(baseUrl: string): OpenAIConfigService {
  return {
    getApiKey: () => undefined,
    getBaseUrl: () => baseUrl,
    isConfigured: () => false,
  };
}

describe("OpenAIPassthroughService", () => {
  it("forwards requests to the configured base URL with the original JSON body", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      requests.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    };

    const service = createOpenAIPassthroughService({
      configService: createConfigService("https://example.test"),
      fetch: fetcher,
    });

    const originalRequest = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const body = {
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    };

    const response = await service.handleCompletion(originalRequest, body);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toBe("https://example.test/v1/chat/completions");
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].init?.body).toBe(JSON.stringify(body));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("aborts the upstream request when the timeout elapses", async () => {
    const fetcher: typeof fetch = async (_input, init) =>
      new Promise((_, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            reject(signal.reason ?? new Error("aborted"));
          },
          { once: true }
        );
      });

    const service = createOpenAIPassthroughService({
      configService: createConfigService("https://example.test"),
      fetch: fetcher,
      timeout: 5,
    });

    const originalRequest = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const outcome = await Promise.race([
      service
        .handleCompletion(originalRequest, { model: "gpt-4" })
        .then(
          () => "resolved",
          () => "rejected"
        ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("timeout"), 100);
      }),
    ]);

    expect(outcome).toBe("rejected");
  });
});
