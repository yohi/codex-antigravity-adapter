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

  it("does not detect partial alias matches", () => {
    const result = detectAlias("@faster hello", new Set(["@fast"]));

    expect(result.alias).toBeNull();
    expect(result.remainingContent).toBe("@faster hello");
  });

  it("does not detect unknown aliases", () => {
    const result = detectAlias("@unknown hello", new Set(["@fast"]));

    expect(result.alias).toBeNull();
    expect(result.remainingContent).toBe("@unknown hello");
  });

  it("returns the remaining content after removing alias and one space", () => {
    const result = detectAlias("@fast hello world", new Set(["@fast"]));

    expect(result.alias).toBe("@fast");
    expect(result.remainingContent).toBe("hello world");
  });
});
