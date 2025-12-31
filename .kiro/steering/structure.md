# Codebase Structure

## Directory Organization

```
/
├── src/
│   ├── auth/           # Authentication logic (OAuth, Token Storage)
│   ├── config/         # Configuration & Constants (Model Catalog)
│   ├── proxy/          # Proxy server & Client logic
│   ├── transformer/    # Request/Response translation (OpenAI <-> Antigravity)
│   ├── utils/          # Shared utilities (Alias detection, Path safety)
│   ├── logging.ts      # Shared logging utilities
│   └── main.ts         # Entry point & Composition root
├── tests/              # Test files (mirroring src/)
├── dist/               # Build artifacts (ignored by git)
├── .codex/             # Prompt templates (ignored by git)
└── .kiro/              # Project knowledge & specs
```

## Key Patterns

### Service Modules
Features are grouped by domain (`auth`, `proxy`). Each module typically exposes:
- **Router:** Hono app definition (`*-router.ts`).
- **Service:** Business logic (`*-service.ts`).
- **Store:** Data persistence (`*-store.ts`).

Example: `ModelSettingsService` in `src/config` handles dynamic model loading.

### Dependency Injection
Components are assembled in `src/main.ts`. Functions like `createAppContext` and `startServers` handle wiring, enabling easier testing and modularity.

### Request Transformation
The `transformer/` directory contains the core logic for mapping between OpenAI and Antigravity schemas. This is separated from the networking logic in `proxy/`.

## File Naming
- Kebab-case for filenames (`auth-service.ts`).
- Descriptive suffixes (`-router`, `-service`, `-store`).
