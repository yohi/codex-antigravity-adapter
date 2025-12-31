import { describe, it, expect, mock } from "bun:test";
import { startApplication, createAppContext } from "../../src/main";
import { createModelAliasConfigService } from "../../src/config/model-alias-config-service";
import type { ModelAliasConfigService } from "../../src/config/model-alias-config-service";

describe("Startup Integration", () => {
  it("should load aliases and inject into app context", async () => {
    const mockLoadAliases = mock(async () => {
      return createModelAliasConfigService().loadAliases({ skipPathSafetyCheck: true });
    });
    
    const mockFactory = {
      loadAliases: mockLoadAliases
    };

    let capturedContext: any = null;
    const mockCreateAppContext = mock((options) => {
        capturedContext = options;
        return createAppContext(options);
    });

    const mockStartAuth = mock(() => ({ stop: () => {} }));
    const mockStartProxy = mock(() => ({ stop: () => {} }));

    await startApplication({
      modelAliasConfigServiceFactory: mockFactory,
      createAppContext: mockCreateAppContext as any,
      startAuthServer: mockStartAuth as any,
      startProxyServer: mockStartProxy as any,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any
    });

    expect(mockLoadAliases).toHaveBeenCalled();
    expect(mockCreateAppContext).toHaveBeenCalled();
    expect(capturedContext.modelAliasConfigService).toBeDefined();
    
    // Check if proxy app has modelRoutingService (indirectly)
    // createAppContext returns { proxyApp, modelRoutingService, ... }
    const contextResult = mockCreateAppContext.mock.results[0].value;
    expect(contextResult.modelRoutingService).toBeDefined();
  });
  
  it("should create routing service if alias config is present", () => {
      const aliasConfig = {
          getAll: () => new Map(),
          getTargetModel: () => undefined,
          hasAlias: () => false,
          listAliases: () => []
      } as ModelAliasConfigService;
      
      const context = createAppContext({
          modelAliasConfigService: aliasConfig
      });
      
      expect(context.modelRoutingService).toBeDefined();
  });

  it("should NOT create routing service if alias config is missing", () => {
      const context = createAppContext({
          modelAliasConfigService: undefined
      });
      
      expect(context.modelRoutingService).toBeUndefined();
  });
});
