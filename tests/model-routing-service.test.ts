import { describe, expect, it } from "bun:test";

import type { ModelAliasConfigService } from "../src/config/model-alias-config-service";
import type { Logger } from "../src/logging";
import type { ChatCompletionRequest } from "../src/transformer/schema";
import {
  createModelRoutingService,
  getLatestUserMessageContent,
} from "../src/proxy/model-routing-service";

type LogEntry = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
};

function createTestLogger() {
  const entries: LogEntry[] = [];
  const logger: Logger = {
    debug: (message, context) => entries.push({ level: "debug", message, context }),
    info: (message, context) => entries.push({ level: "info", message, context }),
    warn: (message, context) => entries.push({ level: "warn", message, context }),
    error: (message, context) => entries.push({ level: "error", message, context }),
  };

  return { entries, logger };
}

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

  it("sanitizes only the latest user message when routing is applied", () => {
    const service = createModelRoutingService({
      aliasConfig: createAliasConfigStub({ "@fast": "gemini-3-flash" }),
    });

    const request: ChatCompletionRequest = {
      model: "gemini-3-pro",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "ack" },
        { role: "user", content: "@fast hello world" },
      ],
    };

    const result = service.route(request);

    expect(result.request.model).toBe("gemini-3-flash");
    expect(result.request.messages[0].content).toBe("first");
    expect(result.request.messages[1].content).toBe("ack");
    expect(result.request.messages[2].content).toBe("hello world");
  });

  it("keeps an empty string when the alias consumes the full content", () => {
    const service = createModelRoutingService({
      aliasConfig: createAliasConfigStub({ "@fast": "gemini-3-flash" }),
    });

    const request: ChatCompletionRequest = {
      model: "gemini-3-pro",
      messages: [{ role: "user", content: "@fast" }],
    };

    const result = service.route(request);

    expect(result.request.model).toBe("gemini-3-flash");
    expect(result.request.messages[0].content).toBe("");
  });

  it("logs routing details when an alias is applied", () => {
    const { entries, logger } = createTestLogger();
    const service = createModelRoutingService({
      aliasConfig: createAliasConfigStub({ "@fast": "gemini-3-flash" }),
      logger,
    });

    const request: ChatCompletionRequest = {
      model: "gemini-3-pro",
      messages: [{ role: "user", content: "@fast hello" }],
    };

    service.route(request);

    const debugEntry = entries.find((entry) => entry.level === "debug");
    expect(debugEntry?.context).toEqual(
      expect.objectContaining({
        originalModel: "gemini-3-pro",
        alias: "@fast",
        targetModel: "gemini-3-flash",
      })
    );
  });

  it("logs errors and returns the original request when routing throws", () => {
    const { entries, logger } = createTestLogger();
    const aliasConfig: ModelAliasConfigService = {
      getTargetModel: () => {
        throw new Error("boom");
      },
      hasAlias: () => true,
      listAliases: () => ["@fast"],
      getAll: () => new Map([["@fast", "gemini-3-flash"]]),
    };
    const service = createModelRoutingService({ aliasConfig, logger });

    const request: ChatCompletionRequest = {
      model: "gemini-3-pro",
      messages: [{ role: "user", content: "@fast hello" }],
    };

    const result = service.route(request);

    expect(result.request).toBe(request);
    expect(result.routed).toBe(false);
    const errorEntry = entries.find((entry) => entry.level === "error");
    expect(errorEntry?.context).toEqual(
      expect.objectContaining({ error: "boom" })
    );
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
