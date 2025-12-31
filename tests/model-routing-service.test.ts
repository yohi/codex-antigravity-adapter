import { describe, expect, it } from "bun:test";

import type { ModelAliasConfigService } from "../src/config/model-alias-config-service";
import type { ChatCompletionRequest } from "../src/transformer/schema";
import {
  createModelRoutingService,
  getLatestUserMessageContent,
} from "../src/proxy/model-routing-service";

function createAliasConfigStub(
  aliases: Record<string, string> = {}
): ModelAliasConfigService {
  const aliasMap = new Map(Object.entries(aliases));
  return {
    getTargetModel: (alias) => aliasMap.get(alias),
    hasAlias: (alias) => aliasMap.has(alias),
    listAliases: () => Array.from(aliasMap.keys()),
    getAll: () => aliasMap,
  };
}

describe("ModelRoutingService", () => {
  it("returns a routing result with the original request when no routing is applied", () => {
    const service = createModelRoutingService({
      aliasConfig: createAliasConfigStub(),
    });

    const request: ChatCompletionRequest = {
      model: "gemini-3-pro",
      messages: [{ role: "user", content: "hello" }],
    };

    const result = service.route(request);

    expect(result.request).toBe(request);
    expect(result.routed).toBe(false);
    expect(result.detectedAlias).toBeUndefined();
    expect(result.originalModel).toBeUndefined();
  });

  it("replaces the model when a configured alias is detected", () => {
    const service = createModelRoutingService({
      aliasConfig: createAliasConfigStub({ "@fast": "gemini-3-flash" }),
    });

    const request: ChatCompletionRequest = {
      model: "gemini-3-pro",
      messages: [{ role: "user", content: "@fast hello" }],
    };

    const result = service.route(request);

    expect(result.request.model).toBe("gemini-3-flash");
    expect(result.routed).toBe(true);
  });

  it("keeps the original model when the alias is unknown", () => {
    const service = createModelRoutingService({
      aliasConfig: createAliasConfigStub({ "@fast": "gemini-3-flash" }),
    });

    const request: ChatCompletionRequest = {
      model: "gemini-3-pro",
      messages: [{ role: "user", content: "@slow hello" }],
    };

    const result = service.route(request);

    expect(result.request).toBe(request);
    expect(result.request.model).toBe("gemini-3-pro");
    expect(result.routed).toBe(false);
  });
});

describe("getLatestUserMessageContent", () => {
  it("returns null when there is no user message", () => {
    const messages: ChatCompletionRequest["messages"] = [
      { role: "system", content: "system" },
      { role: "assistant", content: "ack" },
    ];

    expect(getLatestUserMessageContent(messages)).toBeNull();
  });

  it("returns the content of the latest user message", () => {
    const messages: ChatCompletionRequest["messages"] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "ack" },
      { role: "user", content: "second" },
    ];

    expect(getLatestUserMessageContent(messages)).toBe("second");
  });
});
