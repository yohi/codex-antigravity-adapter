import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

import type { Logger } from "../src/logging";
import { STARTUP_BANNER, startServers } from "../src/main";

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
