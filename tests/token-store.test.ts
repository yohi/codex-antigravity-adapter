import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FileTokenStore, type TokenPair } from "../src/auth/token-store";

describe("FileTokenStore", () => {
  let tempDir: string;
  let tokenFilePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "antigravity-token-"));
    tokenFilePath = path.join(tempDir, "antigravity-tokens.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("saves tokens and loads access token with projectId", async () => {
    const store = new FileTokenStore({ filePath: tokenFilePath });
    const tokens: TokenPair = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 3_600_000,
      projectId: "project-123",
      refreshTokenExpiresAt: Date.now() + 3_600_000,
    };

    const saved = await store.saveTokens(tokens);
    expect(saved.ok).toBe(true);

    const loaded = await store.getAccessToken();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toEqual({
        accessToken: tokens.accessToken,
        projectId: tokens.projectId,
      });
    }

    const persisted = JSON.parse(await readFile(tokenFilePath, "utf8"));
    expect(persisted.accessToken).toBe(tokens.accessToken);
    expect(persisted.refreshToken).toBe(tokens.refreshToken);
    expect(persisted.projectId).toBe(tokens.projectId);
  });

  it("returns NOT_FOUND when no token file exists", async () => {
    const store = new FileTokenStore({ filePath: tokenFilePath });
    const loaded = await store.getAccessToken();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.code).toBe("NOT_FOUND");
      expect(loaded.error.requiresReauth).toBe(true);
    }
  });

  it("refreshes access token when it is expired", async () => {
    const now = Date.now();
    let fetchCalls = 0;
    const store = new FileTokenStore({
      filePath: tokenFilePath,
      now: () => now,
      fetch: async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: "refreshed-access-token",
            expires_in: 600,
            refresh_token: "new-refresh-token",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      },
    });
    const tokens: TokenPair = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: now - 1_000,
      projectId: "project-123",
    };

    await store.saveTokens(tokens);
    const loaded = await store.getAccessToken();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.accessToken).toBe("refreshed-access-token");
    }
    expect(fetchCalls).toBe(1);

    const persisted = JSON.parse(await readFile(tokenFilePath, "utf8"));
    expect(persisted.accessToken).toBe("refreshed-access-token");
    expect(persisted.refreshToken).toBe("new-refresh-token");
    expect(persisted.expiresAt).toBe(now + 600_000);
  });

  it("refreshes access token when expiry is within 5 minutes", async () => {
    const now = Date.now();
    const store = new FileTokenStore({
      filePath: tokenFilePath,
      now: () => now,
      fetch: async () =>
        new Response(
          JSON.stringify({
            access_token: "refreshed-access-token",
            expires_in: 3600,
            refresh_token_expires_in: 7200,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        ),
    });
    const tokens: TokenPair = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: now + 60_000,
      projectId: "project-123",
    };

    await store.saveTokens(tokens);
    const loaded = await store.getAccessToken();
    expect(loaded.ok).toBe(true);

    const persisted = JSON.parse(await readFile(tokenFilePath, "utf8"));
    expect(persisted.accessToken).toBe("refreshed-access-token");
    expect(persisted.expiresAt).toBe(now + 3_600_000);
    expect(persisted.refreshTokenExpiresAt).toBe(now + 7_200_000);
  });

  it("logs refresh events when a logger is provided", async () => {
    const now = Date.now();
    const logs: Array<{ level: string; message: string }> = [];
    const store = new FileTokenStore({
      filePath: tokenFilePath,
      now: () => now,
      logger: {
        debug: (message) => logs.push({ level: "debug", message }),
        info: (message) => logs.push({ level: "info", message }),
        warn: (message) => logs.push({ level: "warn", message }),
        error: (message) => logs.push({ level: "error", message }),
      },
      fetch: async () =>
        new Response(
          JSON.stringify({
            access_token: "refreshed-access-token",
            expires_in: 300,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        ),
    });
    const tokens: TokenPair = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: now - 1_000,
      projectId: "project-123",
    };

    await store.saveTokens(tokens);
    await store.getAccessToken();

    const messages = logs.map((entry) => entry.message);
    expect(messages).toContain("token_refresh_start");
    expect(messages).toContain("token_refresh_success");
  });

  it("retries refresh with exponential backoff on server errors", async () => {
    const now = Date.now();
    const delays: number[] = [];
    let attempts = 0;
    const store = new FileTokenStore({
      filePath: tokenFilePath,
      now: () => now,
      sleep: async (ms) => {
        delays.push(ms);
      },
      fetch: async () => {
        attempts += 1;
        if (attempts < 3) {
          return new Response("server error", { status: 500 });
        }
        return new Response(
          JSON.stringify({
            access_token: "refreshed-access-token",
            expires_in: 900,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      },
    });
    const tokens: TokenPair = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: now - 5_000,
      projectId: "project-123",
    };

    await store.saveTokens(tokens);
    const loaded = await store.getAccessToken();
    expect(loaded.ok).toBe(true);
    expect(attempts).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it("returns REFRESH_FAILED when refresh token is expired", async () => {
    const now = Date.now();
    let fetchCalls = 0;
    const store = new FileTokenStore({
      filePath: tokenFilePath,
      now: () => now,
      fetch: async () => {
        fetchCalls += 1;
        return new Response("should not be called");
      },
    });
    const tokens: TokenPair = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: now - 1_000,
      refreshTokenExpiresAt: now - 1,
      projectId: "project-123",
    };

    await store.saveTokens(tokens);
    const loaded = await store.getAccessToken();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.code).toBe("REFRESH_FAILED");
      expect(loaded.error.requiresReauth).toBe(true);
    }
    expect(fetchCalls).toBe(0);
  });

  it("returns REFRESH_FAILED when refresh is rejected", async () => {
    const now = Date.now();
    const store = new FileTokenStore({
      filePath: tokenFilePath,
      now: () => now,
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "revoked",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        ),
    });
    const tokens: TokenPair = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: now - 1_000,
      projectId: "project-123",
    };

    await store.saveTokens(tokens);
    const loaded = await store.getAccessToken();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.code).toBe("REFRESH_FAILED");
      expect(loaded.error.requiresReauth).toBe(true);
    }
  });

  it("detects token file deletion before refresh", async () => {
    const now = Date.now();
    let fetchCalls = 0;
    const store = new FileTokenStore({
      filePath: tokenFilePath,
      now: () => now,
      fileExists: async () => false,
      fetch: async () => {
        fetchCalls += 1;
        return new Response("should not be called");
      },
    });
    const tokens: TokenPair = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: now - 1_000,
      projectId: "project-123",
    };

    await store.saveTokens(tokens);
    const loaded = await store.getAccessToken();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.code).toBe("NOT_FOUND");
      expect(loaded.error.requiresReauth).toBe(true);
    }
    expect(fetchCalls).toBe(0);
  });

  it("sets permissions to 600 on POSIX", async () => {
    if (process.platform === "win32") {
      return;
    }
    const store = new FileTokenStore({ filePath: tokenFilePath });
    const tokens: TokenPair = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60_000,
      projectId: "project-123",
    };

    await store.saveTokens(tokens);
    const mode = (await stat(tokenFilePath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("does not leave temp files after atomic write", async () => {
    const store = new FileTokenStore({ filePath: tokenFilePath });
    const tokens: TokenPair = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60_000,
      projectId: "project-123",
    };

    await store.saveTokens(tokens);
    const entries = await readdir(tempDir);
    const tempArtifacts = entries.filter((entry) => entry.includes(".tmp."));
    expect(tempArtifacts.length).toBe(0);
  });

  it("rejects empty projectId on save", async () => {
    const store = new FileTokenStore({ filePath: tokenFilePath });
    const tokens: TokenPair = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60_000,
      projectId: "",
    };

    const saved = await store.saveTokens(tokens);
    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.error.code).toBe("IO_ERROR");
    }
  });
});
