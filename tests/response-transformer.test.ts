import { describe, expect, it } from "bun:test";

import {
  transformSingle,
  type AntigravityResponse,
} from "../src/transformer/response";

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
                functionCall: {
                  name: "ping",
                  args: {},
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
});
