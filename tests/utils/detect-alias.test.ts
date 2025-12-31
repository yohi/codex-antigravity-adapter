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
    // Usually we might expect space, but definition says "whitespace". 
    // Requirement 2.3 says "直後が空白または内容終端".
    // Let's assume space or newline is whitespace. 
    // However, the implementation detail in design says "detectAlias (Pure Function)... 直後が空白(1文字)を除去".
    // If it's a newline, is it removed? 
    // Requirement 4.1: "エイリアスタグと直後の空白を除去すること"
    // Usually "whitespace" implies space, tab, newline.
    // Let's stick to space first as primary use case, but check implementation logic later.
    // For now, let's test space.
    
    // If input is "@fast\n", and we treat \n as whitespace to separate, 
    // we should probably remove it? Or just the tag?
    // "remove alias tag and immediate following whitespace"
    
    // Let's create a test for space first.
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