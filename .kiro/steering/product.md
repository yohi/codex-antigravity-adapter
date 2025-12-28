# Product: Codex Antigravity Adapter

## Purpose
A local proxy adapter allowing [Codex CLI](https://github.com/tool-codex/codex-cli) (OpenAI-compatible client) to communicate with Google's internal Antigravity (Cloud Code Assist) API. It handles authentication, protocol translation, and specific API quirks (like "Thinking" blocks and signatures).

## Core Capabilities
- **Local Proxy:** Exposes an OpenAI-compatible `/v1/chat/completions` endpoint.
- **Protocol Translation:**
  - Converts OpenAI chat format (`messages`) to Antigravity format (`contents`).
  - Converts Antigravity SSE streams back to OpenAI-compatible SSE.
  - Handles JSON schema transformation for tools.
- **Authentication:**
  - Manages OAuth2 flow with Google (headless/callback).
  - Persists and refreshes access tokens automatically.
- **Compatibility:**
  - Supports Claude (with thinking block removal for signature validity) and Gemini models.
  - Mitigates "Invalid signature" errors by sanitizing requests.

## User Experience
1. User configures Codex CLI to point to `http://localhost:3000/v1`.
2. User authenticates once via browser.
3. User runs Codex commands as normal; the adapter handles the complex Antigravity handshake transparently.
