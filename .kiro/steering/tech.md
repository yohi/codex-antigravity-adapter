# Tech Stack & Standards

## Core Stack
- **Runtime:** Bun (`>=1.2.19`)
- **Language:** TypeScript (`^5.3`)
- **Server Framework:** Hono (`^4.0`)
- **Validation:** Zod (`^3.22`)
- **Testing:** `bun:test`

## Key Decisions
- **Bun-First:** Leverages `Bun.serve` for high performance and built-in hot reloading (`bun run dev`).
- **Standard Fetch:** Uses standard Web API `fetch`, `Request`, and `Response` objects throughout.
- **No External Request Libs:** Avoids `axios` or `node-fetch`; uses native `fetch`.
- **Functional Composition:** Prefers factory functions (`createApp`, `createService`) over heavy class inheritance, though classes are used for stateful services (Stores).
- **Configuration:**
  - Port is configurable via `PORT` environment variable (default: 3000).
  - Model catalog can be extended via `ANTIGRAVITY_ADDITIONAL_MODELS` (CSV or JSON array) or `.codex/custom-models.json`.

## Development Conventions
- **Imports:** Use explicit relative paths with extensions (e.g., `./auth-router.ts` implied, or specific files if needed).
- **Formatting:** Prettier (or standard JS formatting).
- **Linting:** Standard TypeScript strict mode.
- **Async/Await:** Preferred over raw promises.

## Testing Strategy
- **Unit Tests:** Co-located or in `tests/` mirroring source structure.
- **E2E Tests:** Controlled by env vars (`RUN_E2E=1`) to prevent accidental API usage.
- **Mocking:** Dependency injection via factory functions allows easy mocking of `serve`, `fetch`, etc.
