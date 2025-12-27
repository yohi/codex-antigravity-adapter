import { describe, expect, it } from "bun:test";

import { transformRequestBasics } from "../src/transformer/request";
import type { ChatCompletionRequest } from "../src/transformer/schema";

describe("transformRequestBasics", () => {
  it("converts system/user/assistant messages into Antigravity request content", () => {
    const request: ChatCompletionRequest = {
      model: "gemini-3-flash",
      messages: [
        { role: "system", content: "System prompt A." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "system", content: "System prompt B." },
      ],
    };

    const result = transformRequestBasics(request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.model).toBe("gemini-3-flash");
    expect(result.value.request.contents).toEqual([
      { role: "user", parts: [{ text: "Hello" }] },
      { role: "model", parts: [{ text: "Hi there" }] },
    ]);
    expect(result.value.request.systemInstruction).toEqual({
      parts: [{ text: "System prompt A." }, { text: "System prompt B." }],
    });
  });

  it("maps temperature and max_tokens into generationConfig", () => {
    const request: ChatCompletionRequest = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.4,
      max_tokens: 256,
    };

    const result = transformRequestBasics(request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.request.generationConfig).toEqual({
      temperature: 0.4,
      maxOutputTokens: 256,
    });
  });

  it("omits generationConfig when no generation parameters are set", () => {
    const request: ChatCompletionRequest = {
      model: "gemini-3-pro-high",
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = transformRequestBasics(request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.request.generationConfig).toBeUndefined();
  });

  it("returns unsupported error for tool messages and definitions", () => {
    const request: ChatCompletionRequest = {
      model: "gemini-3-pro-high",
      messages: [
        { role: "user", content: "Hello" },
        { role: "tool", tool_call_id: "call-1", content: "result" },
      ],
      tools: [
        {
          type: "function",
          function: { name: "do_work", parameters: { type: "object" } },
        },
      ],
    };

    const result = transformRequestBasics(request);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("UNSUPPORTED_FEATURE");
  });
});
