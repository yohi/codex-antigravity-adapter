import type { Hono } from "hono";

import { createAuthApp, startAuthServer, type AuthServerOptions } from "./auth/auth-router";
import { OAuthAuthService } from "./auth/auth-service";
import { FileTokenStore } from "./auth/token-store";
import { createLogger, isDebugEnabled, NOOP_LOGGER, type Logger, wrapFetchWithLogging } from "./logging";
import { createAntigravityRequester } from "./proxy/antigravity-client";
import { createProxyApp, startProxyServer, type ProxyServerOptions } from "./proxy/proxy-router";
import { createTransformService } from "./proxy/transform-service";
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

export function initializeRuntime(): { sessionId: string } {
  DEFAULT_SIGNATURE_CACHE.pruneExpired();
  return { sessionId: SESSION_ID };
}

export function createAppContext(options: { logger?: Logger } = {}) {
  const logger = options.logger ?? NOOP_LOGGER;
  initializeRuntime();

  const tokenStore = new FileTokenStore({ logger });
  const authService = new OAuthAuthService({ tokenStore });
  const requester = createAntigravityRequester({ logger });
  const transformService = createTransformService({ tokenStore, requester });
  const authApp = createAuthApp(authService);
  const proxyApp = createProxyApp({ transformService });

  return {
    authApp,
    proxyApp,
    tokenStore,
    authService,
    transformService,
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

export function startApplication(options: { debug?: boolean; logger?: Logger } = {}) {
  const debug = options.debug ?? isDebugEnabled(process.env.ANTIGRAVITY_DEBUG_LOGS);
  const logger = options.logger ?? createLogger({ debug });
  logger.info(STARTUP_BANNER, { status: "starting" });
  const { authApp, proxyApp } = createAppContext({ logger });
  return startServers({ authApp, proxyApp, logger, debug });
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
  startApplication();
}
