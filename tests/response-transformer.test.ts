import { describe, expect, it } from "bun:test";

import {
  transformSingle,
  transformStream,
  type AntigravityResponse,
} from "../src/transformer/response";

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

describe("transformSingle", () => {
  it("converts candidates into an OpenAI chat completion response", () => {
    const response: AntigravityResponse = {
      model: "gemini-3-flash",
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "Hello" }, { text: " world" }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 3,
        candidatesTokenCount: 5,
        totalTokenCount: 8,
      },
    };

    const result = transformSingle(response, "req-1", "session-1", {
      now: () => 1_700_000_000_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value).toEqual({
      id: "chatcmpl-req-1",
      object: "chat.completion",
      created: 1_700_000_000,
      model: "gemini-3-flash",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hello world",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 5,
        total_tokens: 8,
      },
    });
  });

  it("returns an error when candidates contain non-text parts", () => {
    const response: AntigravityResponse = {
      model: "gemini-3-flash",
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionResponse: {
                  name: "ping",
                  response: {},
                },
              },
            ],
          },
        },
      ],
    };

    const result = transformSingle(response, "req-2", "session-1");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("UNSUPPORTED_FEATURE");
  });

  it("converts function calls into tool_calls", () => {
    const response: AntigravityResponse = {
      model: "gemini-3-flash",
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "lookup",
                  args: { city: "Tokyo", unit: "C" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };

    const result = transformSingle(response, "req-3", "session-1", {
      now: () => 1_700_000_000_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value).toEqual({
      id: "chatcmpl-req-3",
      object: "chat.completion",
      created: 1_700_000_000,
      model: "gemini-3-flash",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "lookup",
                  arguments: "{\"city\":\"Tokyo\",\"unit\":\"C\"}",
                },
              },
            ],
          },
          finish_reason: "stop",
        },
      ],
    });
  });
});

describe("transformStream", () => {
  it("converts Antigravity SSE responses into OpenAI SSE chunks", async () => {
    const upstream = [
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
        "\n\n",
    ].join("");

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(upstream));
        controller.close();
      },
    });

    const output = await readStream(
      transformStream(stream, "req-stream-1", "session-1", {
        now: () => 1_700_000_000_000,
      })
    );
    const events = parseSseEvents(output);

    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0])).toEqual({
      id: "chatcmpl-req-stream-1",
      object: "chat.completion.chunk",
      created: 1_700_000_000,
      model: "gemini-3-flash",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: "Hello",
          },
          finish_reason: "stop",
        },
      ],
    });
    expect(events[1]).toBe("[DONE]");
  });

  it("streams tool_calls when functionCall parts are present", async () => {
    const upstream = [
      "data: " +
        JSON.stringify({
          response: {
            model: "gemini-3-flash",
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        id: "call_custom",
                        name: "lookup",
                        args: { city: "Tokyo" },
                      },
                    },
                  ],
                },
              },
            ],
          },
        }) +
        "\n\n",
    ].join("");

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(upstream));
        controller.close();
      },
    });

    const output = await readStream(
      transformStream(stream, "req-stream-2", "session-1", {
        now: () => 1_700_000_000_000,
      })
    );
    const events = parseSseEvents(output);

    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0])).toEqual({
      id: "chatcmpl-req-stream-2",
      object: "chat.completion.chunk",
      created: 1_700_000_000,
      model: "gemini-3-flash",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_custom",
                type: "function",
                function: {
                  name: "lookup",
                  arguments: "{\"city\":\"Tokyo\"}",
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    expect(events[1]).toBe("[DONE]");
  });

  it("converts upstream error chunks into OpenAI error events", async () => {
    const upstream = [
      "data: " +
        JSON.stringify({
          error: {
            message: "Upstream failed",
          },
        }) +
        "\n\n",
    ].join("");

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(upstream));
        controller.close();
      },
    });

    const output = await readStream(
      transformStream(stream, "req-stream-3", "session-1", {
        now: () => 1_700_000_000_000,
      })
    );
    const events = parseSseEvents(output);

    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0])).toEqual({
      error: {
        type: "upstream_error",
        code: "upstream_error",
        message: "Upstream failed",
      },
    });
    expect(events[1]).toBe("[DONE]");
  });
});
