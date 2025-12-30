import { describe, expect, it } from "bun:test";

import { detectAlias } from "../../src/utils/detect-alias";

describe("detectAlias", () => {
  it("returns non-detection and preserves content when no @ prefix", () => {
    const content = "hello @fast";
    const result = detectAlias(content, new Set(["@fast"]));

    expect(result.alias).toBeNull();
    expect(result.remainingContent).toBe(content);
  });

  it("detects alias when followed by a space and removes the tag", () => {
    const result = detectAlias("@fast hello", new Set(["@fast"]));

    expect(result.alias).toBe("@fast");
    expect(result.remainingContent).toBe("hello");
  });

  it("detects alias when content is only the alias", () => {
    const result = detectAlias("@fast", new Set(["@fast"]));

    expect(result.alias).toBe("@fast");
    expect(result.remainingContent).toBe("");
  });
});
