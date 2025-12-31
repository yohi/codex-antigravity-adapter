import { describe, it, expect } from "bun:test";
import { detectAlias } from "../../src/utils/detect-alias";

describe("detectAlias", () => {
  const aliases = new Set(["@fast", "@think", "@pro"]);

  it("should detect alias at the beginning of content", () => {
    const content = "@fast Tell me a joke";
    const result = detectAlias(content, aliases);
    expect(result.alias).toBe("@fast");
    expect(result.remainingContent).toBe("Tell me a joke");
  });

  it("should detect alias with newline after", () => {
    const content = "@think\nAnalysis started";
    const result = detectAlias(content, aliases);
    expect(result.alias).toBe("@think");
    expect(result.remainingContent).toBe("Analysis started");
  });

  it("should detect alias exactly matching content", () => {
    const content = "@fast";
    const result = detectAlias(content, aliases);
    expect(result.alias).toBe("@fast");
    expect(result.remainingContent).toBe("");
  });

  it("should return null if content does not start with @", () => {
    const content = "Hello @fast world";
    const result = detectAlias(content, aliases);
    expect(result.alias).toBe(null);
    expect(result.remainingContent).toBe(content);
  });

  it("should return null for unknown alias", () => {
    const content = "@unknown request";
    const result = detectAlias(content, aliases);
    expect(result.alias).toBe(null);
    expect(result.remainingContent).toBe(content);
  });

  it("should return null for partial match", () => {
    const content = "@faster request";
    const result = detectAlias(content, aliases);
    expect(result.alias).toBe(null);
    expect(result.remainingContent).toBe(content);
  });
  
  it("should remove immediate following space", () => {
     const content = "@fast  Double space";
     const result = detectAlias(content, aliases);
     expect(result.alias).toBe("@fast");
     // Removes alias "@fast" and ONE immediate following whitespace.
     // "@fast " (length 6) -> removed.
     // remaining: " Double space" (starts with space)
     expect(result.remainingContent).toBe(" Double space");
  });
});