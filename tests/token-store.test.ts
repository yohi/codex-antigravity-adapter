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
      expiresAt: Date.now() + 60_000,
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

  it("returns EXPIRED when access token is expired", async () => {
    const store = new FileTokenStore({ filePath: tokenFilePath });
    const tokens: TokenPair = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 1_000,
      projectId: "project-123",
    };

    await store.saveTokens(tokens);
    const loaded = await store.getAccessToken();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.code).toBe("EXPIRED");
      expect(loaded.error.requiresReauth).toBe(true);
    }
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
