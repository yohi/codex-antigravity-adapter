import { afterEach, describe, expect, it } from "bun:test";

const RUN_E2E = process.env.RUN_E2E === "1";
const USE_RUNNING_SERVER = process.env.E2E_OPENAI_USE_RUNNING_SERVER === "1";

const OPENAI_BASE_URL =
  process.env.E2E_OPENAI_BASE_URL ?? "https://api.openai.com";
const OPENAI_API_KEY = process.env.E2E_OPENAI_API_KEY;
const OPENAI_MODEL = process.env.E2E_OPENAI_MODEL ?? "gpt-4o-mini";
const OPENAI_STREAM_MODEL = process.env.E2E_OPENAI_STREAM_MODEL ?? OPENAI_MODEL;

const PROXY_PORT = Number(process.env.E2E_OPENAI_PROXY_PORT ?? "3002");
const PROXY_BASE_URL =
  process.env.E2E_OPENAI_PROXY_URL ?? `http://127.0.0.1:${PROXY_PORT}`;
const CHAT_COMPLETIONS_URL = `${PROXY_BASE_URL}/v1/chat/completions`;
const MODELS_URL = `${PROXY_BASE_URL}/v1/models`;

const maybeIt = RUN_E2E ? it : it.skip;
const maybeOpenAiIt = RUN_E2E && OPENAI_API_KEY ? it : it.skip;

let serverProcess: Bun.Subprocess | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOk(url: string, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // ignore until timeout
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startServer(env: Record<string, string>) {
  if (USE_RUNNING_SERVER) {
    await waitForOk(MODELS_URL);
    return;
  }
  if (serverProcess) {
    throw new Error("Server already running");
  }

  serverProcess = Bun.spawn({
    cmd: ["bun", "src/main.ts"],
    env: { ...process.env, PORT: String(PROXY_PORT), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForOk(MODELS_URL);
}

async function stopServer() {
  if (USE_RUNNING_SERVER) {
    return;
  }
  if (serverProcess) {
    serverProcess.kill();
    await serverProcess.exited;
    serverProcess = null;
  }
}

async function readSsePayload(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

function parseSseEvents(payload: string): string[] {
  return payload
    .split("\n\n")
    .filter((event) => event.trim().length > 0)
    .map((event) => {
      const lines = event.split("\n");
      const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      return dataLines.join("\n");
    })
    .filter((data) => data.length > 0);
}

afterEach(async () => {
  await stopServer();
});

describe("E2E: OpenAI passthrough", () => {
  maybeOpenAiIt("forwards non-streaming chat completions to the upstream API", async () => {
    await startServer({
      OPENAI_API_KEY: OPENAI_API_KEY ?? "",
      OPENAI_BASE_URL,
    });

    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: "Say hello in one short sentence." }],
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Array.isArray(payload.choices)).toBe(true);
    expect(payload.choices.length).toBeGreaterThan(0);
  });

  maybeOpenAiIt("relays streaming chat completions and ends with [DONE]", async () => {
    await startServer({
      OPENAI_API_KEY: OPENAI_API_KEY ?? "",
      OPENAI_BASE_URL,
    });

    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_STREAM_MODEL,
        messages: [{ role: "user", content: "Stream a short response." }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await readSsePayload(response.body as ReadableStream<Uint8Array>);
    const events = parseSseEvents(payload);
    expect(events[events.length - 1]).toBe("[DONE]");
  });

  maybeIt("passes through upstream authentication errors", async () => {
    await startServer({
      OPENAI_API_KEY: "sk-invalid",
      OPENAI_BASE_URL,
    });

    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.error).toBeTruthy();
  });

  maybeIt("returns bad_gateway when the upstream is unreachable", async () => {
    await startServer({
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "http://127.0.0.1:59999",
    });

    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.error?.code).toBe("bad_gateway");
  });

  maybeIt("detects stream start errors before relaying", async () => {
    await startServer({
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "http://127.0.0.1:59998",
    });

    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_STREAM_MODEL,
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.error?.code).toBe("bad_gateway");
  });

  maybeIt("returns invalid_response when upstream JSON is malformed", async () => {
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response("{ invalid-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    try {
      await startServer({
        OPENAI_API_KEY: "sk-test",
        OPENAI_BASE_URL: `http://127.0.0.1:${upstream.port}`,
      });

      const response = await fetch(CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(response.status).toBe(502);
      const payload = await response.json();
      expect(payload.error?.code).toBe("invalid_response");
    } finally {
      upstream.stop();
    }
  });
});
