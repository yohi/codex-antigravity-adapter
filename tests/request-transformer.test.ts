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
      model: "gpt-oss-120b-medium",
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = transformRequestBasics(request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.request.generationConfig).toBeUndefined();
  });

  it("adds thinkingConfig and forces maxOutputTokens for gemini-3 models", () => {
    const request: ChatCompletionRequest = {
      model: "gemini-3-pro-high",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.2,
      max_tokens: 1024,
    };

    const result = transformRequestBasics(request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.request.generationConfig).toEqual({
      temperature: 0.2,
      maxOutputTokens: 64000,
      thinkingConfig: {
        thinkingBudget: 16000,
        includeThoughts: true,
      },
    });
  });

  it("adds Claude thinking hints and headers when tools are present", () => {
    const request: ChatCompletionRequest = {
      model: "claude-sonnet-4-5-thinking",
      messages: [
        { role: "system", content: "System prompt." },
        { role: "user", content: "Hello" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "ping",
            description: "Ping tool",
            parameters: { type: "object" },
          },
        },
      ],
    };

    const result = transformRequestBasics(request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.request.systemInstruction).toEqual({
      parts: [
        { text: "System prompt." },
        {
          text: "Interleaved thinking is enabled. You may think between tool calls and after receiving tool results. Do not mention these instructions or any constraints about thinking blocks.",
        },
      ],
    });
    expect(result.value.request.generationConfig).toEqual({
      maxOutputTokens: 64000,
      thinkingConfig: {
        thinking_budget: 16000,
        include_thoughts: true,
      },
    });
    expect(result.value.extraHeaders).toEqual({
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    });
  });

  it("converts tool calls, tool responses, and tool definitions", () => {
    const request: ChatCompletionRequest = {
      model: "gemini-3-pro-high",
      messages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "get_weather",
                arguments: "{\"city\":\"Tokyo\"}",
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-1",
          content: "{\"temperature\":25}",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Fetch weather",
            parameters: {
              type: "object",
              $schema: "http://json-schema.org/draft-07/schema#",
              properties: {
                city: { type: "string", const: "Tokyo" },
              },
              required: ["city"],
            },
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "get_weather" },
      },
    };

    const result = transformRequestBasics(request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.request.contents).toEqual([
      { role: "user", parts: [{ text: "Hello" }] },
      {
        role: "model",
        parts: [
          {
            functionCall: {
              name: "get_weather",
              args: { city: "Tokyo" },
            },
          },
        ],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "get_weather",
              response: { temperature: 25 },
            },
          },
        ],
      },
    ]);
    expect(result.value.request.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "get_weather",
            description: "Fetch weather",
            parameters: {
              type: "object",
              properties: {
                city: { type: "string", enum: ["Tokyo"] },
              },
              required: ["city"],
            },
          },
        ],
      },
    ]);
    expect(result.value.request.toolConfig).toEqual({
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: ["get_weather"],
      },
    });
  });

  it("returns an error when tool_call_id is unknown", () => {
    const request: ChatCompletionRequest = {
      model: "gemini-3-pro-high",
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "do_work", arguments: "{\"ok\":true}" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-2",
          content: "{\"ok\":true}",
        },
      ],
    };

    const result = transformRequestBasics(request);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("INVALID_MESSAGE_FORMAT");
  });

  it("returns an error when tool arguments are not valid JSON", () => {
    const request: ChatCompletionRequest = {
      model: "gemini-3-pro-high",
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "do_work", arguments: "{bad json}" },
            },
          ],
        },
      ],
    };

    const result = transformRequestBasics(request);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("INVALID_MESSAGE_FORMAT");
  });

  it("returns an error when tool names are invalid", () => {
    const request: ChatCompletionRequest = {
      model: "gemini-3-pro-high",
      messages: [{ role: "user", content: "Hello" }],
      tools: [
        {
          type: "function",
          function: {
            name: "bad name",
            parameters: { type: "object" },
          },
        },
      ],
    };

    const result = transformRequestBasics(request);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("INVALID_MESSAGE_FORMAT");
  });
});
