import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const RUN_E2E = process.env.RUN_E2E === "1";
const RUN_TOOL_FLOW = process.env.E2E_TOOL_FLOW === "1";
const RUN_REFRESH_FLOW = process.env.E2E_REFRESH_FLOW === "1";
const USE_RUNNING_SERVER = process.env.E2E_USE_RUNNING_SERVER === "1";
const TOOL_FLOW_STRICT = process.env.E2E_TOOL_FLOW_STRICT === "1";

const AUTH_BASE_URL = process.env.E2E_AUTH_URL ?? "http://127.0.0.1:51121";
const PROXY_BASE_URL = process.env.E2E_PROXY_URL ?? "http://127.0.0.1:3000";
const CHAT_COMPLETIONS_URL = `${PROXY_BASE_URL}/v1/chat/completions`;
const MODELS_URL = `${PROXY_BASE_URL}/v1/models`;

const DEFAULT_MODEL = process.env.E2E_MODEL ?? "gemini-3-flash";
const TOOL_MODEL = process.env.E2E_TOOL_MODEL ?? DEFAULT_MODEL;

const TOKEN_FILE_PATH =
  process.env.E2E_TOKEN_PATH ??
  path.join(os.homedir(), ".codex", "antigravity-tokens.json");

const maybeIt = RUN_E2E ? it : it.skip;
const maybeToolIt = RUN_E2E && RUN_TOOL_FLOW ? it : it.skip;
const maybeRefreshIt = RUN_E2E && RUN_REFRESH_FLOW ? it : it.skip;

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

async function startServerIfNeeded() {
  if (USE_RUNNING_SERVER) {
    await waitForOk(`${AUTH_BASE_URL}/auth/status`);
    await waitForOk(MODELS_URL);
    return;
  }

  serverProcess = Bun.spawn({
    cmd: ["bun", "src/main.ts"],
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForOk(`${AUTH_BASE_URL}/auth/status`);
  await waitForOk(MODELS_URL);
}

async function stopServerIfNeeded() {
  if (!serverProcess) {
    return;
  }
  serverProcess.kill();
  await serverProcess.exited;
  serverProcess = null;
}

async function loadTokenPayload(): Promise<Record<string, unknown>> {
  const raw = await readFile(TOKEN_FILE_PATH, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("E2E: real environment", () => {
  beforeAll(async () => {
    if (!RUN_E2E) {
      return;
    }
    if (!existsSync(TOKEN_FILE_PATH)) {
      throw new Error(
        `Token file not found at ${TOKEN_FILE_PATH}. Run the OAuth login flow before E2E tests.`
      );
    }
    await startServerIfNeeded();
  });

  afterAll(async () => {
    if (!RUN_E2E) {
      return;
    }
    await stopServerIfNeeded();
  });

  maybeIt("exposes the OAuth login endpoint", async () => {
    const response = await fetch(`${AUTH_BASE_URL}/login`, { redirect: "manual" });
    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
  });

  maybeIt("reports authentication status", async () => {
    const response = await fetch(`${AUTH_BASE_URL}/auth/status`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ authenticated: true });
  });

  maybeIt("handles non-streaming chat completions", async () => {
    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: "Say hello in one short sentence." }],
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.choices?.length).toBeGreaterThan(0);
    expect(payload.choices[0].message?.role).toBe("assistant");
  });

  maybeIt("handles streaming chat completions", async () => {
    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: "Stream a short response." }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await readSsePayload(response.body as ReadableStream<Uint8Array>);
    const events = parseSseEvents(payload);
    expect(events[events.length - 1]).toBe("[DONE]");
  });

  maybeToolIt("supports tool calls and follow-up tool responses", async () => {
    const toolRequest = {
      model: TOOL_MODEL,
      messages: [
        {
          role: "user",
          content: "Use the tool to add 2 and 3.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "add_numbers",
            description: "Add two numbers together",
            parameters: {
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
            },
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "add_numbers" },
      },
    };

    const first = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toolRequest),
    });

    if (first.status === 429 && !TOOL_FLOW_STRICT) {
      return;
    }
    expect(first.status).toBe(200);
    const firstPayload = await first.json();
    const toolCalls = firstPayload.choices?.[0]?.message?.tool_calls ?? [];
    if (toolCalls.length === 0) {
      if (TOOL_FLOW_STRICT) {
        throw new Error(
          "Tool calls not returned. Set E2E_TOOL_MODEL to a tool-enabled model."
        );
      }
      return;
    }
    const toolCall = toolCalls[0];

    const followup = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: TOOL_MODEL,
        messages: [
          ...toolRequest.messages,
          {
            role: "assistant",
            content: null,
            tool_calls: toolCalls,
          },
          {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ result: 5 }),
          },
        ],
      }),
    });

    expect(followup.status).toBe(200);
    const followupPayload = await followup.json();
    expect(followupPayload.choices?.length).toBeGreaterThan(0);
  });

  maybeRefreshIt("refreshes access tokens when expired", async () => {
    const original = await loadTokenPayload();
    const expired = { ...original, expiresAt: Date.now() - 1000 };
    await writeFile(TOKEN_FILE_PATH, JSON.stringify(expired, null, 2));

    try {
      const response = await fetch(CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: [{ role: "user", content: "Verify refresh flow." }],
        }),
      });

      expect(response.status).toBe(200);
    } finally {
      await writeFile(TOKEN_FILE_PATH, JSON.stringify(original, null, 2));
    }
  });
});
