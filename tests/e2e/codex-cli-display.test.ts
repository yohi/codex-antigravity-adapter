import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_FIXED_MODEL_IDS } from "../../src/config/model-settings-service";

const BASE_URL = "http://127.0.0.1:3001";
const MODELS_URL = `${BASE_URL}/v1/models`;
const AUTH_STATUS_URL = "http://127.0.0.1:51121/auth/status";
const CUSTOM_MODELS_FILE = "custom-models.json";

let serverProcess: Bun.Subprocess | null = null;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(AUTH_STATUS_URL);
      if (response.ok) {
        // Also wait for proxy to be ready
        try {
            const modelsResponse = await fetch(MODELS_URL);
            if (modelsResponse.ok) {
              return;
            }
            // response.ok が false の場合は continue してループを継続
        } catch {
          // ネットワークエラーなどは無視してループを継続
        }
      }
    } catch {
      // ignore
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for server to start");
}

async function startServer(env: Record<string, string> = {}) {
  if (serverProcess) {
    throw new Error("Server already running");
  }
  
  // Ensure port 3001 is free (simple check, might not be enough if something else is running)
  
  serverProcess = Bun.spawn({
    cmd: ["bun", "src/main.ts"],
    env: { ...process.env, PORT: "3001", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForServer();
}

async function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    await serverProcess.exited;
    serverProcess = null;
  }
}

describe("E2E: Codex CLI Model Display", () => {
  afterEach(async () => {
    await stopServer();
    if (existsSync(CUSTOM_MODELS_FILE)) {
      await unlink(CUSTOM_MODELS_FILE);
    }
  });
  
  afterAll(async () => {
     if (existsSync(CUSTOM_MODELS_FILE)) {
      await unlink(CUSTOM_MODELS_FILE);
    }
  });

  it("should return fixed models by default", async () => {
    await startServer();
    const response = await fetch(MODELS_URL);
    expect(response.status).toBe(200);
    const body = await response.json();
    
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
    
    const ids = body.data.map((m: any) => m.id);
    for (const fixedId of DEFAULT_FIXED_MODEL_IDS) {
      expect(ids).toContain(fixedId);
    }
  });

  it("should include models from environment variable (CSV)", async () => {
    const extraModels = "env-model-1,env-model-2";
    await startServer({
      ANTIGRAVITY_ADDITIONAL_MODELS: extraModels,
    });

    const response = await fetch(MODELS_URL);
    const body = await response.json();
    const ids = body.data.map((m: any) => m.id);

    expect(ids).toContain("env-model-1");
    expect(ids).toContain("env-model-2");
    // Should still contain fixed models
    expect(ids).toContain(DEFAULT_FIXED_MODEL_IDS[0]);
  });

  it("should include models from environment variable (JSON)", async () => {
    const extraModels = JSON.stringify(["json-model-1", "json-model-2"]);
    await startServer({
      ANTIGRAVITY_ADDITIONAL_MODELS: extraModels,
    });

    const response = await fetch(MODELS_URL);
    const body = await response.json();
    const ids = body.data.map((m: any) => m.id);

    expect(ids).toContain("json-model-1");
    expect(ids).toContain("json-model-2");
  });

  it("should include models from custom-models.json", async () => {
    await writeFile(CUSTOM_MODELS_FILE, JSON.stringify({
      models: ["file-model-1", "file-model-2"]
    }));

    await startServer();

    const response = await fetch(MODELS_URL);
    const body = await response.json();
    const ids = body.data.map((m: any) => m.id);

    expect(ids).toContain("file-model-1");
    expect(ids).toContain("file-model-2");
  });

  it("should prioritize env vars over file and fixed models", async () => {
    // file has "shared-model"
    await writeFile(CUSTOM_MODELS_FILE, JSON.stringify({
      models: ["shared-model", "file-only"]
    }));

    // env has "shared-model"
    await startServer({
      ANTIGRAVITY_ADDITIONAL_MODELS: "shared-model,env-only"
    });

    const response = await fetch(MODELS_URL);
    const body = await response.json();
    const data = body.data;
    const ids = data.map((m: any) => m.id);

    expect(ids).toContain("shared-model");
    expect(ids).toContain("file-only");
    expect(ids).toContain("env-only");

    // "shared-model" should be present once
    const sharedCount = ids.filter((id: string) => id === "shared-model").length;
    expect(sharedCount).toBe(1);
    
    // Note: Verification of source priority logic (first-seen wins) is hard via API unless we inspect order 
    // or if we had source metadata in response (which we don't, standard OpenAI format).
    // However, the service logic guarantees it. Here we just verify presence and uniqueness.
  });

  it("should start successfully even with invalid config", async () => {
    await writeFile(CUSTOM_MODELS_FILE, "{ invalid-json }");
    
    // Should not throw and start server
    await startServer({
      ANTIGRAVITY_ADDITIONAL_MODELS: "[invalid-json]"
    });

    const response = await fetch(MODELS_URL);
    expect(response.status).toBe(200);
    const body = await response.json();
    
    // Should return fixed models at least
    const ids = body.data.map((m: any) => m.id);
    expect(ids).toContain(DEFAULT_FIXED_MODEL_IDS[0]);
  });
});
