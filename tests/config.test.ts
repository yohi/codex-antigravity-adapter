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
    // This test documents the expected behavior when IS_INTERNAL_ONLY is false
    // The actual value is hardcoded in the config file
    const { IS_INTERNAL_ONLY } = await import("../src/config/antigravity.ts");

    if (!IS_INTERNAL_ONLY) {
      delete process.env.ANTIGRAVITY_SCOPES;
      delete require.cache[require.resolve("../src/config/antigravity.ts")];

      const { ANTIGRAVITY_SCOPES } = await import("../src/config/antigravity.ts");

      expect(ANTIGRAVITY_SCOPES).not.toContain(
        "https://www.googleapis.com/auth/cclog"
      );
      expect(ANTIGRAVITY_SCOPES).not.toContain(
        "https://www.googleapis.com/auth/experimentsandconfigs"
      );
      expect(ANTIGRAVITY_SCOPES).not.toContain(
        "https://www.googleapis.com/auth/cloud-platform"
      );
      expect(ANTIGRAVITY_SCOPES).toContain(
        "https://www.googleapis.com/auth/cloud-platform.read-only"
      );
    }
  });
});
