import { describe, expect, it, beforeEach, afterEach } from "bun:test";

describe("Antigravity Config", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Save original environment
    originalEnv = {
      ANTIGRAVITY_SCOPES: process.env.ANTIGRAVITY_SCOPES,
      ANTIGRAVITY_CLIENT_ID: process.env.ANTIGRAVITY_CLIENT_ID,
      ANTIGRAVITY_CLIENT_SECRET: process.env.ANTIGRAVITY_CLIENT_SECRET,
    };

    // Set required env vars for config to load
    process.env.ANTIGRAVITY_CLIENT_ID = "test-client-id";
    process.env.ANTIGRAVITY_CLIENT_SECRET = "test-client-secret";
  });

  afterEach(() => {
    // Restore original environment
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });

    // Clear module cache to reload config with fresh env
    delete require.cache[require.resolve("../src/config/antigravity.ts")];
  });

  it("includes internal scopes when IS_INTERNAL_ONLY is true", async () => {
    delete process.env.ANTIGRAVITY_SCOPES;

    // Import fresh to pick up current IS_INTERNAL_ONLY
    const { ANTIGRAVITY_SCOPES, IS_INTERNAL_ONLY } = await import(
      "../src/config/antigravity.ts"
    );

    if (IS_INTERNAL_ONLY) {
      expect(ANTIGRAVITY_SCOPES).toContain("https://www.googleapis.com/auth/cclog");
      expect(ANTIGRAVITY_SCOPES).toContain(
        "https://www.googleapis.com/auth/experimentsandconfigs"
      );
      expect(ANTIGRAVITY_SCOPES).toContain(
        "https://www.googleapis.com/auth/cloud-platform"
      );
    }
  });

  it("includes user identity scopes", async () => {
    delete process.env.ANTIGRAVITY_SCOPES;

    const { ANTIGRAVITY_SCOPES } = await import("../src/config/antigravity.ts");

    expect(ANTIGRAVITY_SCOPES).toContain(
      "https://www.googleapis.com/auth/userinfo.email"
    );
    expect(ANTIGRAVITY_SCOPES).toContain(
      "https://www.googleapis.com/auth/userinfo.profile"
    );
  });

  it("allows scope override via environment variable", async () => {
    const customScopes = "scope1,scope2,scope3";
    process.env.ANTIGRAVITY_SCOPES = customScopes;

    // Clear cache and reimport
    delete require.cache[require.resolve("../src/config/antigravity.ts")];
    const { ANTIGRAVITY_SCOPES } = await import("../src/config/antigravity.ts");

    expect(ANTIGRAVITY_SCOPES).toEqual(["scope1", "scope2", "scope3"]);
  });

  it("trims whitespace from custom scopes", async () => {
    const customScopes = " scope1 , scope2 , scope3 ";
    process.env.ANTIGRAVITY_SCOPES = customScopes;

    // Clear cache and reimport
    delete require.cache[require.resolve("../src/config/antigravity.ts")];
    const { ANTIGRAVITY_SCOPES } = await import("../src/config/antigravity.ts");

    expect(ANTIGRAVITY_SCOPES).toEqual(["scope1", "scope2", "scope3"]);
  });

  it("does not include internal scopes in external mode", async () => {
    // Save original environment variables
    const originalIsInternal = process.env.ANTIGRAVITY_IS_INTERNAL_ONLY;
    const originalScopes = process.env.ANTIGRAVITY_SCOPES;

    try {
      // Force external mode by setting environment variable
      process.env.ANTIGRAVITY_IS_INTERNAL_ONLY = 'false';
      delete process.env.ANTIGRAVITY_SCOPES;

      // Clear require cache for Bun/Node.js compatibility
      const modulePath = require.resolve("../src/config/antigravity.ts");
      delete require.cache[modulePath];

      // Re-import the module with cache-busting query parameter
      // This ensures fresh module evaluation with new environment variables
      const timestamp = Date.now();
      const { ANTIGRAVITY_SCOPES, IS_INTERNAL_ONLY } = await import(`../src/config/antigravity.ts?t=${timestamp}`);

      // Verify we're in external mode
      expect(IS_INTERNAL_ONLY).toBe(false);

      // Verify internal scopes are not included
      expect(ANTIGRAVITY_SCOPES).not.toContain(
        "https://www.googleapis.com/auth/cclog"
      );
      expect(ANTIGRAVITY_SCOPES).not.toContain(
        "https://www.googleapis.com/auth/experimentsandconfigs"
      );
      expect(ANTIGRAVITY_SCOPES).not.toContain(
        "https://www.googleapis.com/auth/cloud-platform"
      );

      // Verify read-only scope is included for external mode
      expect(ANTIGRAVITY_SCOPES).toContain(
        "https://www.googleapis.com/auth/cloud-platform.read-only"
      );
    } finally {
      // Restore original environment variables
      if (originalIsInternal === undefined) {
        delete process.env.ANTIGRAVITY_IS_INTERNAL_ONLY;
      } else {
        process.env.ANTIGRAVITY_IS_INTERNAL_ONLY = originalIsInternal;
      }

      if (originalScopes === undefined) {
        delete process.env.ANTIGRAVITY_SCOPES;
      } else {
        process.env.ANTIGRAVITY_SCOPES = originalScopes;
      }
    }
  });
});
