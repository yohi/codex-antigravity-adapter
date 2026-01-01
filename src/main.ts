import type { Hono } from "hono";

import { createAuthApp, startAuthServer, type AuthServerOptions } from "./auth/auth-router";
import { OAuthAuthService } from "./auth/auth-service";
import { FileTokenStore } from "./auth/token-store";
import {
  createModelAliasConfigService,
  type ModelAliasConfigService,
  type ModelAliasConfigServiceFactory,
} from "./config/model-alias-config-service";
import {
  createModelSettingsService,
  DEFAULT_FIXED_MODEL_IDS,
  type ModelCatalog,
  type ModelSettingsService,
} from "./config/model-settings-service";
import {
  createOpenAIConfigService,
  type OpenAIConfigService,
} from "./config/openai-config-service";
import { createLogger, isDebugEnabled, NOOP_LOGGER, type Logger, wrapFetchWithLogging } from "./logging";
import { createAntigravityRequester } from "./proxy/antigravity-client";
import {
  createModelRoutingService,
  type ModelRoutingService,
} from "./proxy/model-routing-service";
import {
  createOpenAIPassthroughService,
  type OpenAIPassthroughService,
} from "./proxy/openai-passthrough-service";
import { createProxyApp, startProxyServer, type ProxyServerOptions } from "./proxy/proxy-router";
import { createTransformService, type TransformService } from "./proxy/transform-service";
import { DEFAULT_SIGNATURE_CACHE, SESSION_ID } from "./transformer/helpers";

export const STARTUP_BANNER = "codex-antigravity-adapter";

export type ServerHandle = { stop?: () => void };

export type StartServersOptions = {
  authApp: Hono;
  proxyApp: Hono;
  logger?: Logger;
  debug?: boolean;
  authOptions?: AuthServerOptions;
  proxyOptions?: ProxyServerOptions;
  startAuthServer?: typeof startAuthServer;
  startProxyServer?: typeof startProxyServer;
  onSignal?: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void;
};

export type CreateAppContextOptions = {
  logger?: Logger;
  modelCatalog?: ModelCatalog;
  modelAliasConfigService?: ModelAliasConfigService;
  createProxyApp?: typeof createProxyApp;
};

export type AppContext = {
  authApp: Hono;
  proxyApp: Hono;
  tokenStore: FileTokenStore;
  authService: OAuthAuthService;
  transformService: TransformService;
  modelAliasConfigService?: ModelAliasConfigService;
  modelRoutingService?: ModelRoutingService;
  openaiConfigService: OpenAIConfigService;
  openaiPassthroughService: OpenAIPassthroughService;
};

export function initializeRuntime(): { sessionId: string } {
  DEFAULT_SIGNATURE_CACHE.pruneExpired();
  return { sessionId: SESSION_ID };
}

export function createAppContext(options: CreateAppContextOptions = {}): AppContext {
  const logger = options.logger ?? NOOP_LOGGER;
  const modelCatalog = options.modelCatalog;
  const modelAliasConfigService = options.modelAliasConfigService;
  const buildProxyApp = options.createProxyApp ?? createProxyApp;
  initializeRuntime();

  const tokenStore = new FileTokenStore({ logger });
  const authService = new OAuthAuthService({ tokenStore });
  const requester = createAntigravityRequester({ logger });
  const transformService = createTransformService({ tokenStore, requester });

  const openaiConfigService = createOpenAIConfigService();
  const openaiPassthroughService = createOpenAIPassthroughService({
    configService: openaiConfigService,
  });

  if (openaiConfigService.isConfigured()) {
    logger.info("OpenAI passthrough service initialized with server API key");
  } else {
    logger.info(
      "OpenAI passthrough service initialized in Auth Passthrough mode (client Authorization header will be used)"
    );
  }

  const authApp = createAuthApp(authService);
  const modelRoutingService = modelAliasConfigService
    ? createModelRoutingService({ aliasConfig: modelAliasConfigService, logger })
    : undefined;
  const proxyApp = buildProxyApp({
    transformService,
    modelCatalog,
    modelRoutingService,
    openaiPassthroughService,
  });

  return {
    authApp,
    proxyApp,
    tokenStore,
    authService,
    transformService,
    modelAliasConfigService,
    modelRoutingService,
    openaiConfigService,
    openaiPassthroughService,
  };
}

export function startServers(options: StartServersOptions) {
  const logger = options.logger ?? NOOP_LOGGER;
  const debug = options.debug ?? false;
  const onSignal = options.onSignal ?? ((signal, handler) => process.on(signal, handler));

  const authServe = resolveServe(options.authOptions?.serve, logger, debug, "auth");
  const proxyServe = resolveServe(options.proxyOptions?.serve, logger, debug, "proxy");

  const authServer = (options.startAuthServer ?? startAuthServer)(
    options.authApp,
    { ...options.authOptions, serve: authServe }
  );
  const proxyServer = (options.startProxyServer ?? startProxyServer)(
    options.proxyApp,
    { ...options.proxyOptions, serve: proxyServe }
  );

  logger.info("server_start", { service: "auth" });
  logger.info("server_start", { service: "proxy" });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("server_shutdown_start");
    authServer?.stop?.();
    proxyServer?.stop?.();
    logger.info("server_shutdown_complete");
  };

  onSignal("SIGINT", shutdown);
  onSignal("SIGTERM", shutdown);

  return { authServer, proxyServer, shutdown };
}

type LoadModelCatalogOptions = {
  logger: Logger;
  modelSettingsService?: ModelSettingsService;
  fixedModelIds?: readonly string[];
  now?: () => number;
};

type CatalogLogEntry = {
  level: "warn" | "error";
  message: string;
};

export async function loadModelCatalog(
  options: LoadModelCatalogOptions
): Promise<ModelCatalog> {
  const baseLogger = options.logger;
  const modelSettingsService =
    options.modelSettingsService ?? createModelSettingsService();
  const fixedModelIds = options.fixedModelIds ?? DEFAULT_FIXED_MODEL_IDS;
  const now = options.now ?? (() => Date.now());
  const { logger, entries } = createCapturingLogger(baseLogger);

  try {
    const catalog = await modelSettingsService.load({
      logger,
      fixedModelIds,
      now,
    });
    const errors = entries.map((entry) => ({
      level: entry.level,
      message: entry.message,
    }));
    if (errors.length === 0) {
      baseLogger.info("Model catalog loaded successfully", {
        sources: catalog.sources,
        totalModels: catalog.models.length,
      });
    } else {
      baseLogger.info("Model catalog loaded with partial errors", {
        sources: catalog.sources,
        totalModels: catalog.models.length,
        errors,
      });
    }
    return catalog;
  } catch (error) {
    const fallbackCatalog = buildFixedModelCatalog(fixedModelIds, now);
    baseLogger.warn("Model catalog loaded with errors, using fixed models only", {
      sources: fallbackCatalog.sources,
      totalModels: fallbackCatalog.models.length,
      errors: [
        {
          level: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    });
    return fallbackCatalog;
  }
}

function createCapturingLogger(baseLogger: Logger): {
  logger: Logger;
  entries: CatalogLogEntry[];
} {
  const entries: CatalogLogEntry[] = [];
  const logger: Logger = {
    debug: (message, context) => baseLogger.debug(message, context),
    info: (message, context) => baseLogger.info(message, context),
    warn: (message, context) => {
      entries.push({ level: "warn", message });
      baseLogger.warn(message, context);
    },
    error: (message, context) => {
      entries.push({ level: "error", message });
      baseLogger.error(message, context);
    },
  };

  return { logger, entries };
}

function buildFixedModelCatalog(
  fixedModelIds: readonly string[],
  now: () => number
): ModelCatalog {
  const created = Math.floor(now() / 1000);
  return {
    models: fixedModelIds.map((id) => ({
      id,
      object: "model",
      created,
      owned_by: "antigravity",
    })),
    sources: {
      fixed: fixedModelIds.length,
      file: 0,
      env: 0,
    },
  };
}

/**
 * Parses and validates a port number from a string value.
 * Returns the port number if valid (1-65535), otherwise undefined.
 *
 * @param value - The string value to parse
 * @returns A valid port number or undefined
 */
function parsePort(value: string | undefined): number | undefined {
  if (!value || value.trim() === "") {
    return undefined;
  }

  const trimmed = value.trim();

  // Reject strings that don't represent valid integers (e.g., decimals, non-numeric)
  // Use a regex to ensure the string contains only digits
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = parseInt(trimmed, 10);

  // Check if parsing was successful and the result is a finite integer
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return undefined;
  }

  // Validate TCP port range (1-65535)
  if (parsed < 1 || parsed > 65535) {
    return undefined;
  }

  return parsed;
}

function createEmptyAliasConfigService(): ModelAliasConfigService {
  const aliasMap = new Map<string, string>();
  return {
    getTargetModel: (alias) => aliasMap.get(alias),
    hasAlias: (alias) => aliasMap.has(alias),
    listAliases: () => [],
    getAll: () => aliasMap as ReadonlyMap<string, string>,
  };
}

export type StartApplicationOptions = {
  debug?: boolean;
  logger?: Logger;
  modelSettingsService?: ModelSettingsService;
  modelAliasConfigServiceFactory?: ModelAliasConfigServiceFactory;
  fixedModelIds?: readonly string[];
  now?: () => number;
  createAppContext?: (options: CreateAppContextOptions) => AppContext;
  startAuthServer?: typeof startAuthServer;
  startProxyServer?: typeof startProxyServer;
};

export async function startApplication(options: StartApplicationOptions = {}) {
  const debug = options.debug ?? isDebugEnabled(process.env.ANTIGRAVITY_DEBUG_LOGS);
  const logger = options.logger ?? createLogger({ debug });
  logger.info(STARTUP_BANNER, { status: "starting" });
  const modelCatalog = await loadModelCatalog({
    logger,
    modelSettingsService: options.modelSettingsService,
    fixedModelIds: options.fixedModelIds,
    now: options.now,
  });
  const aliasFactory =
    options.modelAliasConfigServiceFactory ?? createModelAliasConfigService();
  let modelAliasConfigService: ModelAliasConfigService;
  try {
    modelAliasConfigService = await aliasFactory.loadAliases({ logger });
  } catch (error) {
    logger.error("Failed to load model aliases", {
      error: error instanceof Error ? error.message : String(error),
    });
    modelAliasConfigService = createEmptyAliasConfigService();
  }
  const buildAppContext = options.createAppContext ?? createAppContext;
  const { authApp, proxyApp } = buildAppContext({
    logger,
    modelCatalog,
    modelAliasConfigService,
  });
  const proxyPort = parsePort(process.env.PORT);
  return startServers({
    authApp,
    proxyApp,
    logger,
    debug,
    proxyOptions: { port: proxyPort },
    startAuthServer: options.startAuthServer,
    startProxyServer: options.startProxyServer,
  });
}

type ServeOptions = {
  fetch: (request: Request) => Response | Promise<Response>;
  port: number;
  hostname: string;
};

function resolveServe(
  serve: ((options: ServeOptions) => ServerHandle) | undefined,
  logger: Logger,
  debug: boolean,
  label: string
): ((options: ServeOptions) => ServerHandle) | undefined {
  if (!debug) {
    return serve;
  }
  const baseServe =
    serve ??
    ((serveOptions: ServeOptions) => {
      return Bun.serve(serveOptions);
    });
  return (serveOptions) =>
    baseServe({
      ...serveOptions,
      fetch: wrapFetchWithLogging(serveOptions.fetch, { logger, label }),
    });
}

if (import.meta.main) {
  startApplication().catch((error) => {
    console.error("startup_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
