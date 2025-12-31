import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

import type {
  LoadAliasesOptions,
  ModelAliasConfigService,
  ModelAliasConfigServiceFactory,
} from "../src/config/model-alias-config-service";
import type { Logger } from "../src/logging";
import { NOOP_LOGGER } from "../src/logging";
import type { ModelSettingsService } from "../src/config/model-settings-service";
import type { AppContext, CreateAppContextOptions } from "../src/main";
import { STARTUP_BANNER, createAppContext, startApplication, startServers } from "../src/main";
import { createProxyApp, type CreateProxyAppOptions } from "../src/proxy/proxy-router";
import type { TransformService } from "../src/proxy/transform-service";
import type { ChatCompletionRequest } from "../src/transformer/schema";

const mockModelSettingsService: ModelSettingsService = {
  load: async () => ({
    models: [{ id: "test-model", object: "model", created: 1234567890, owned_by: "test" }],
    sources: { fixed: 1, file: 0, env: 0 },
  }),
};

function createLogCollector() {
  const entries: Array<{
    level: "debug" | "info" | "warn" | "error";
    message: string;
    context?: Record<string, unknown>;
  }> = [];
  const logger: Logger = {
    debug: (message, context) => entries.push({ level: "debug", message, context }),
    info: (message, context) => entries.push({ level: "info", message, context }),
    warn: (message, context) => entries.push({ level: "warn", message, context }),
    error: (message, context) => entries.push({ level: "error", message, context }),
  };
  return { entries, logger };
}

function createTransformServiceStub(
  onRequest?: (request: ChatCompletionRequest) => void,
  response: unknown = { id: "resp-1" }
): TransformService {
  return {
    handleCompletion: async (request) => {
      onRequest?.(request);
      return { ok: true, value: response };
    },
  };
}

describe("main", () => {
  it("exposes the startup banner", () => {
    expect(STARTUP_BANNER).toBe("codex-antigravity-adapter");
  });

  it("logs requests and shuts down servers on signals", async () => {
    const authApp = new Hono();
    authApp.get("/ping", (c) => c.text("auth"));
    const proxyApp = new Hono();
    proxyApp.get("/ping", (c) => c.text("proxy"));

    const { entries, logger } = createLogCollector();
    const authFetches: Array<(request: Request) => Response | Promise<Response>> = [];
    const proxyFetches: Array<(request: Request) => Response | Promise<Response>> = [];
    let authStopCalls = 0;
    let proxyStopCalls = 0;
    const signalHandlers: Record<string, () => void> = {};

    startServers({
      authApp,
      proxyApp,
      logger,
      debug: true,
      authOptions: {
        serve: (options) => {
          authFetches.push(options.fetch);
          return { stop: () => (authStopCalls += 1) };
        },
      },
      proxyOptions: {
        serve: (options) => {
          proxyFetches.push(options.fetch);
          return { stop: () => (proxyStopCalls += 1) };
        },
      },
      onSignal: (signal, handler) => {
        signalHandlers[signal] = handler;
      },
    });

    expect(authFetches).toHaveLength(1);
    expect(proxyFetches).toHaveLength(1);

    await authFetches[0](new Request("http://localhost/ping"));
    await proxyFetches[0](new Request("http://localhost/ping"));

    const debugMessages = entries
      .filter((entry) => entry.level === "debug")
      .map((entry) => entry.message);
    expect(debugMessages).toContain("request_start");
    expect(debugMessages).toContain("request_end");

    expect(typeof signalHandlers.SIGINT).toBe("function");
    expect(typeof signalHandlers.SIGTERM).toBe("function");

    signalHandlers.SIGINT();
    expect(authStopCalls).toBe(1);
    expect(proxyStopCalls).toBe(1);
  });
});

describe("createAppContext model routing", () => {
  it("creates a routing service and passes it to createProxyApp", () => {
    let listAliasesCalls = 0;
    const aliasConfigService: ModelAliasConfigService = {
      getTargetModel: (alias) => (alias === "@fast" ? "gemini-fast" : undefined),
      hasAlias: (alias) => alias === "@fast",
      listAliases: () => {
        listAliasesCalls += 1;
        return ["@fast"];
      },
      getAll: () => new Map([["@fast", "gemini-fast"]]),
    };
    let capturedProxyOptions: CreateProxyAppOptions | undefined;

    const context = createAppContext({
      logger: NOOP_LOGGER,
      modelAliasConfigService: aliasConfigService,
      createProxyApp: (options) => {
        capturedProxyOptions = options;
        return new Hono();
      },
    });

    expect(listAliasesCalls).toBe(1);
    expect(context.modelRoutingService).toBeDefined();
    expect(capturedProxyOptions?.modelRoutingService).toBe(context.modelRoutingService);

    const routingService = context.modelRoutingService;
    if (!routingService) {
      throw new Error("modelRoutingService is undefined");
    }

    const request: ChatCompletionRequest = {
      model: "gemini-3-pro-high",
      messages: [{ role: "user", content: "@fast hello" }],
    };

    const result = routingService.route(request);
    expect(result.routed).toBe(true);
    expect(result.request.model).toBe("gemini-fast");
    expect(result.request.messages[0]).toMatchObject({
      role: "user",
      content: "hello",
    });
  });
});

describe("createAppContext proxy integration", () => {
  it("returns responses with routing enabled", async () => {
    const aliasConfigService: ModelAliasConfigService = {
      getTargetModel: (alias) => (alias === "@fast" ? "gemini-fast" : undefined),
      hasAlias: (alias) => alias === "@fast",
      listAliases: () => ["@fast"],
      getAll: () => new Map([["@fast", "gemini-fast"]]),
    };
    let capturedRequest: ChatCompletionRequest | null = null;

    const context = createAppContext({
      logger: NOOP_LOGGER,
      modelAliasConfigService: aliasConfigService,
      createProxyApp: (options) =>
        createProxyApp({
          transformService: createTransformServiceStub(
            (request) => {
              capturedRequest = request;
            },
            { id: "resp-routing" }
          ),
          modelCatalog: options.modelCatalog,
          modelRoutingService: options.modelRoutingService,
        }),
    });

    expect(context.modelAliasConfigService).toBe(aliasConfigService);

    const response = await context.proxyApp.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3-flash",
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "@fast hello" }],
            },
          ],
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "resp-routing" });
    expect(capturedRequest).toMatchObject({
      model: "gemini-fast",
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("returns responses without routing configured", async () => {
    let capturedRequest: ChatCompletionRequest | null = null;

    const context = createAppContext({
      logger: NOOP_LOGGER,
      createProxyApp: (options) =>
        createProxyApp({
          transformService: createTransformServiceStub(
            (request) => {
              capturedRequest = request;
            },
            { id: "resp-pass" }
          ),
          modelCatalog: options.modelCatalog,
          modelRoutingService: options.modelRoutingService,
        }),
    });

    expect(context.modelRoutingService).toBeUndefined();

    const response = await context.proxyApp.request(
      "http://localhost/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gemini-3-flash",
          messages: [{ role: "user", content: "Hello." }],
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "resp-pass" });
    expect(capturedRequest).toMatchObject({
      model: "gemini-3-flash",
      messages: [{ role: "user", content: "Hello." }],
    });
  });
});

describe("startApplication model aliases", () => {
  it("loads model aliases and injects the config service into createAppContext", async () => {
    const aliasConfigService: ModelAliasConfigService = {
      getTargetModel: (alias) => (alias === "@fast" ? "gemini-fast" : undefined),
      hasAlias: (alias) => alias === "@fast",
      listAliases: () => ["@fast"],
      getAll: () => new Map([["@fast", "gemini-fast"]]),
    };
    let capturedLoadOptions: LoadAliasesOptions | undefined;
    let capturedOptions: CreateAppContextOptions | undefined;

    const modelAliasConfigServiceFactory: ModelAliasConfigServiceFactory = {
      loadAliases: async (options) => {
        capturedLoadOptions = options;
        return aliasConfigService;
      },
    };

    await startApplication({
      logger: NOOP_LOGGER,
      modelSettingsService: mockModelSettingsService,
      modelAliasConfigServiceFactory,
      createAppContext: (options) => {
        capturedOptions = options;
        return {
          authApp: new Hono(),
          proxyApp: new Hono(),
        } as AppContext;
      },
      startAuthServer: () => ({ stop: () => {} }),
      startProxyServer: () => ({ stop: () => {} }),
    });

    expect(capturedLoadOptions?.logger).toBe(NOOP_LOGGER);
    expect(capturedOptions?.modelAliasConfigService).toBe(aliasConfigService);
  });

  it("logs errors when model alias loading fails and continues with an empty config", async () => {
    const { entries, logger } = createLogCollector();
    let capturedOptions: CreateAppContextOptions | undefined;

    const modelAliasConfigServiceFactory: ModelAliasConfigServiceFactory = {
      loadAliases: async () => {
        throw new Error("alias load failed");
      },
    };

    await startApplication({
      logger,
      modelSettingsService: mockModelSettingsService,
      modelAliasConfigServiceFactory,
      createAppContext: (options) => {
        capturedOptions = options;
        return {
          authApp: new Hono(),
          proxyApp: new Hono(),
        } as AppContext;
      },
      startAuthServer: () => ({ stop: () => {} }),
      startProxyServer: () => ({ stop: () => {} }),
    });

    const errorEntry = entries.find(
      (entry) =>
        entry.level === "error" && entry.message === "Failed to load model aliases"
    );
    expect(errorEntry).toBeTruthy();
    expect(errorEntry?.context).toMatchObject({ error: "alias load failed" });
    expect(capturedOptions?.modelAliasConfigService?.listAliases()).toEqual([]);
  });
});

describe("startApplication PORT parsing", () => {
  /**
   * Helper to test PORT parsing with automatic environment cleanup
   */
  async function testPortParsing(
    portValue: string | undefined,
    expectedPort: number | undefined
  ) {
    const originalPORT = process.env.PORT;
    try {
      if (portValue === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = portValue;
      }

      let capturedPort: number | undefined;
      await startApplication({
        logger: NOOP_LOGGER,
        modelSettingsService: mockModelSettingsService,
        startAuthServer: () => ({ stop: () => {} }),
        startProxyServer: (_, options) => {
          capturedPort = options?.port;
          return { stop: () => {} };
        }
      });

      expect(capturedPort).toBe(expectedPort);
    } finally {
      if (originalPORT !== undefined) {
        process.env.PORT = originalPORT;
      } else {
        delete process.env.PORT;
      }
    }
  }

  it("parses valid PORT with radix 10", async () => {
    await testPortParsing("3000", 3000);
  });

  it("falls back to undefined for invalid PORT (out of range low)", async () => {
    await testPortParsing("0", undefined);
  });

  it("falls back to undefined for invalid PORT (out of range high)", async () => {
    await testPortParsing("70000", undefined);
  });

  it("falls back to undefined for non-numeric PORT", async () => {
    await testPortParsing("abc", undefined);
  });

  it("falls back to undefined for decimal PORT", async () => {
    await testPortParsing("12.34", undefined);
  });

  it("falls back to undefined for empty PORT", async () => {
    await testPortParsing("", undefined);
  });

  it("uses undefined when PORT is not set", async () => {
    await testPortParsing(undefined, undefined);
  });
});
