import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  createModelRoutingService,
  type ModelRoutingService,
} from "../../src/proxy/model-routing-service";
import type { ModelAliasConfigService } from "../../src/config/model-alias-config-service";
import type { ChatCompletionRequest } from "../../src/transformer/schema";

describe("ModelRoutingService", () => {
  let mockAliasConfig: ModelAliasConfigService;
  let service: ModelRoutingService;
  const mockLogger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;

  beforeEach(() => {
    mockAliasConfig = {
      getTargetModel: mock((alias) => {
        if (alias === "@fast") return "gemini-3-flash";
        if (alias === "@think") return "claude-sonnet";
        return undefined;
      }),
      hasAlias: mock((alias) => ["@fast", "@think"].includes(alias)),
      listAliases: mock(() => ["@fast", "@think"]),
      getAll: mock(() => new Map([["@fast", "gemini-3-flash"], ["@think", "claude-sonnet"]])),
    };

    service = createModelRoutingService({
      aliasConfig: mockAliasConfig,
      logger: mockLogger,
    });
  });

  const baseRequest: ChatCompletionRequest = {
    model: "original-model",
    messages: [
      { role: "system", content: "System prompt" },
      { role: "user", content: "User prompt" },
    ],
  };

  it("should pass through if no alias detected", () => {
    const request = { ...baseRequest };
    const result = service.route(request);

    expect(result.routed).toBe(false);
    expect(result.request).toBe(request); // Same reference if not routed (preferred) or equal
    expect(result.request.model).toBe("original-model");
  });

  it("should route and sanitize if alias matches", () => {
    const request = {
      ...baseRequest,
      messages: [
        { role: "system", content: "System" },
        { role: "user", content: "@fast Hello world" },
      ],
    };
    const result = service.route(request);

    expect(result.routed).toBe(true);
    expect(result.request.model).toBe("gemini-3-flash");
    expect(result.detectedAlias).toBe("@fast");
    expect(result.originalModel).toBe("original-model");
    
    // Check sanitation
    const lastMsg = result.request.messages[1];
    if (lastMsg.role !== "user") throw new Error("Expected user message");
    expect(lastMsg.content).toBe("Hello world");
    
    // Logger check
    expect(mockLogger.debug).toHaveBeenCalled();
  });

  it("should pass through if alias is unknown", () => {
    const request = {
      ...baseRequest,
      messages: [
        { role: "user", content: "@unknown Hello" },
      ],
    };
    const result = service.route(request);

    expect(result.routed).toBe(false);
    expect(result.request.model).toBe("original-model");
    // Should not change content if not routed?
    // Requirement 3.2: If not in config, keep original model.
    // Requirement 4: Sanitize ONLY IF routed? 
    // Requirement 3.2: "元の model 値を保持すること"
    // What about content? 
    // Requirement 4.1: "When エイリアスによるルーティングが適用された場合...除去すること"
    // So if NOT routed (unknown alias), do NOT remove alias? 
    // Requirement 5.1: "If エイリアスが検出されない場合...変更せず転送"
    // DetectAlias logic finds "@unknown" but Config says it doesn't exist.
    // Logic flow:
    // 1. Detect candidate alias (starts with @, followed by space)
    // 2. Check if alias in config.
    // 3. If yes -> Route & Sanitize.
    // 4. If no -> Do nothing?
    
    // My detectAlias checks against `knownAliases`.
    // Ah! `detectAlias` takes `knownAliases` set.
    // So `detectAlias` will return null for `@unknown` because it's not in the set passed to it.
    // So `detectAlias` handles the "is it a valid alias" check.
    
    // So for `@unknown`, `detectAlias` returns null.
    // So `route` sees null and does nothing.
    const lastMsg = result.request.messages[0];
    if (lastMsg.role !== "user") throw new Error("Expected user message");
    expect(lastMsg.content).toBe("@unknown Hello");
  });

  it("should only affect the last user message", () => {
    const request = {
      ...baseRequest,
      messages: [
        { role: "user", content: "@fast old message" },
        { role: "assistant", content: "response" },
        { role: "user", content: "@think new message" },
      ],
    };
    const result = service.route(request);

    expect(result.routed).toBe(true);
    expect(result.request.model).toBe("claude-sonnet");
    
    // First message should remain untouched
    const firstMsg = result.request.messages[0];
    if (firstMsg.role !== "user") throw new Error();
    expect(firstMsg.content).toBe("@fast old message");
    
    // Last message sanitized
    const lastMsg = result.request.messages[2];
    if (lastMsg.role !== "user") throw new Error();
    expect(lastMsg.content).toBe("new message");
  });

  it("should handle empty remaining content", () => {
    const request = {
      ...baseRequest,
      messages: [{ role: "user", content: "@fast" }],
    };
    const result = service.route(request);

    expect(result.routed).toBe(true);
    expect(result.request.model).toBe("gemini-3-flash");
    const lastMsg = result.request.messages[0];
    expect(lastMsg.content).toBe("");
  });
  
  it("should ignore requests with no user messages", () => {
      const request = {
          ...baseRequest,
          messages: [{ role: "system", content: "sys" }]
      };
      const result = service.route(request);
      expect(result.routed).toBe(false);
  });
  
  it("should handle exceptions gracefully (fail open)", () => {
      // Mock failure in alias detection or something
      // Since detectAlias is pure, maybe mock logger failure? 
      // Or mock request structure issue if we can force it (types prevent it though).
      // We can force mockAliasConfig to throw.
      mockAliasConfig.listAliases = mock(() => { throw new Error("Config Error"); });
      // But we probably cache the set? 
      // Let's assume implementation calls listAliases or getAll.
      
      // If I implement it to call getAll() inside route(), I can mock throw.
      // But optimization might be to cache `knownAliases` set.
      // If I construct `service` it might call `getAll`.
      
      // If `route` calls `detectAlias`, it needs the set.
      // If I mock `getAll` to throw, `createModelRoutingService` or `route` might fail.
      // If the service caches the set on creation, I can't mock failure during `route` easily unless I mock `detectAlias`? 
      // But `detectAlias` is imported.
      
      // I'll assume the service gets the set from config on each request OR caches it.
      // Given config is static-ish, caching is good, but getting from config ensures freshness if config could update (it currently doesn't).
      // The design doesn't strictly say when to get aliases. 
      // `detectAlias` takes `knownAliases: ReadonlySet<string>`.
      
      // If I want to test exception handling in `route`, I can try to pass a malformed request if I cast it, 
      // or mock the dependency to throw.
      // Let's try mocking `getAll` to throw inside `route` if implemented that way, 
      // OR mock `logger.debug` to throw (unlikely to happen in real life but triggers catch block).
      
      mockLogger.debug = mock(() => { throw new Error("Log Error"); });
      
      const request = {
        ...baseRequest,
        messages: [{ role: "user", content: "@fast hi" }]
      };
      
      // This should trigger route -> match -> log -> throw -> catch -> return original
      const result = service.route(request);
      
      // Expect pass through due to error
      expect(result.routed).toBe(false);
      expect(result.request).toBe(request);
      expect(mockLogger.error).toHaveBeenCalled();
  });
});
