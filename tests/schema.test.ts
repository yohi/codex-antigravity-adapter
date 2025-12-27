import { describe, expect, it } from "bun:test";

import { ChatCompletionRequestSchema } from "../src/transformer/schema";

describe("ChatCompletionRequestSchema", () => {
  const baseRequest = {
    model: "gemini-3-pro-high",
    messages: [
      { role: "system", content: "You are a test." },
      { role: "user", content: "Hello" },
    ],
  };

  it("normalizes user content arrays to a single string", () => {
    const request = {
      ...baseRequest,
      messages: [
        baseRequest.messages[0],
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: " world" },
          ],
        },
      ],
    };

    const parsed = ChatCompletionRequestSchema.parse(request);
    expect(parsed.messages[1]).toEqual({ role: "user", content: "Hello world" });
  });

  it("rejects multimodal content", () => {
    const request = {
      ...baseRequest,
      messages: [
        baseRequest.messages[0],
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            { type: "image_url", image_url: { url: "https://example.com" } },
          ],
        },
      ],
    };

    expect(() => ChatCompletionRequestSchema.parse(request)).toThrow();
  });

  it("rejects logprobs parameter", () => {
    const request = { ...baseRequest, logprobs: 1 };
    expect(() => ChatCompletionRequestSchema.parse(request)).toThrow();
  });

  it("rejects n greater than 1", () => {
    const request = { ...baseRequest, n: 2 };
    expect(() => ChatCompletionRequestSchema.parse(request)).toThrow();
  });

  it("requires tool_call_id for tool role", () => {
    const request = {
      ...baseRequest,
      messages: [
        ...baseRequest.messages,
        { role: "tool", content: "result" },
      ],
    };

    expect(() => ChatCompletionRequestSchema.parse(request)).toThrow();
  });

  it("accepts assistant tool_calls with null content", () => {
    const request = {
      ...baseRequest,
      messages: [
        ...baseRequest.messages,
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "do_work",
                arguments: "{}",
              },
            },
          ],
        },
      ],
    };

    const parsed = ChatCompletionRequestSchema.parse(request);
    expect(parsed.messages[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "do_work", arguments: "{}" },
        },
      ],
    });
  });

  it("accepts tools and tool_choice function", () => {
    const request = {
      ...baseRequest,
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            description: "Lookup data",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "lookup" },
      },
    };

    expect(() => ChatCompletionRequestSchema.parse(request)).not.toThrow();
  });

  it("rejects unsupported tool_choice", () => {
    const request = {
      ...baseRequest,
      tool_choice: "required",
    };

    expect(() => ChatCompletionRequestSchema.parse(request)).toThrow();
  });
});
