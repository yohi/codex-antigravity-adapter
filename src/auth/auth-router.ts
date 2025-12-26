import { Hono } from "hono";

import type { AuthService } from "./auth-service";

type ServeOptions = {
  fetch: (request: Request) => Response | Promise<Response>;
  port: number;
  hostname: string;
};

export type AuthServerOptions = {
  port?: number;
  hostname?: string;
  serve?: (options: ServeOptions) => { stop?: () => void };
};

const DEFAULT_AUTH_PORT = 51121;
const DEFAULT_AUTH_HOSTNAME = "127.0.0.1";

export function createAuthApp(authService: AuthService): Hono {
  const app = new Hono();

  app.get("/login", (c) => {
    const result = authService.generateAuthUrl();
    if (!result.ok) {
      return c.html(
        renderAuthPage("Authentication failed", result.error.message),
        500
      );
    }
    return c.redirect(result.value.url, 302);
  });

  app.get("/oauth-callback", async (c) => {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return c.html(
        renderAuthPage(
          "Authentication failed",
          "Missing required query parameters."
        ),
        400
      );
    }

    const exchange = await authService.exchangeToken(code, state);
    if (!exchange.ok) {
      const status = exchange.error.code === "INVALID_STATE" ? 400 : 500;
      return c.html(
        renderAuthPage("Authentication failed", exchange.error.message),
        status
      );
    }

    return c.html(
      renderAuthPage(
        "Authentication complete",
        "You can return to the CLI and close this window."
      ),
      200
    );
  });

  app.get("/auth/status", async (c) => {
    try {
      const authenticated = await authService.isAuthenticated();
      return c.json({ authenticated }, 200);
    } catch {
      return c.json(
        {
          error: {
            type: "server_error",
            code: "internal_error",
            message: "Failed to determine authentication status.",
          },
        },
        500
      );
    }
  });

  app.notFound((c) =>
    c.json(
      {
        error: {
          type: "invalid_request_error",
          code: "unknown_endpoint",
          message: "Unknown endpoint",
        },
      },
      404
    )
  );

  return app;
}

export function startAuthServer(app: Hono, options: AuthServerOptions = {}) {
  const port = options.port ?? DEFAULT_AUTH_PORT;
  const hostname = options.hostname ?? DEFAULT_AUTH_HOSTNAME;
  const serve =
    options.serve ??
    ((serveOptions: ServeOptions) => {
      return Bun.serve(serveOptions);
    });

  return serve({ fetch: app.fetch, port, hostname });
}

function renderAuthPage(title: string, message: string): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
