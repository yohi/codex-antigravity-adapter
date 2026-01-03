# Product: Codex Antigravity Adapter

## Purpose
A local proxy adapter allowing [Codex CLI](https://github.com/tool-codex/codex-cli) (OpenAI-compatible client) to communicate with Google's internal Antigravity (Cloud Code Assist) API. It handles authentication, protocol translation, and specific API quirks (like "Thinking" blocks and signatures).

## Core Capabilities
- **Local Proxy:** Exposes OpenAI-compatible `/v1/chat/completions` and `/v1/models` endpoints.
- **Model Discovery:**
  - Provides a list of available models (Gemini, Claude, etc.) to clients.
  - Supports dynamic model catalog expansion via environment variables and local JSON files.
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
- **OpenAI Passthrough:**
  - Proxies requests directly to OpenAI (or compatible upstreams) when configured.
  - Supports configurable Base URL and Auth passthrough.
  - Handles timeout management (default 60s) and error normalization.
- **Dynamic Model Routing:**
  - Request-time model selection via alias tags (e.g. `@fast`) in prompts.
  - Sanitizes prompts by removing aliases before forwarding.

## User Experience
1. User configures Codex CLI to point to `http://localhost:3000/v1`.
2. User authenticates once via browser.
3. User runs Codex commands as normal; the adapter handles the complex Antigravity handshake transparently.
