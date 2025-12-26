import { describe, expect, it } from "bun:test";

import { STARTUP_BANNER } from "../src/main";

describe("main", () => {
  it("exposes the startup banner", () => {
    expect(STARTUP_BANNER).toBe("codex-antigravity-adapter");
  });
});
