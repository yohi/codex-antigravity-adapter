import { describe, expect, it } from "bun:test";

import type { ModelAliasConfigService } from "../src/config/model-alias-config-service";
import type { ChatCompletionRequest } from "../src/transformer/schema";
import { createModelRoutingService } from "../src/proxy/model-routing-service";

function createAliasConfigStub(): ModelAliasConfigService {
  return {
    getTargetModel: () => undefined,
    hasAlias: () => false,
    listAliases: () => [],
    getAll: () => new Map(),
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
});
