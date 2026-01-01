import { describe, expect, it } from "bun:test";
import { isAntigravityModel } from "../../src/proxy/routing-utils";

describe("isAntigravityModel", () => {
  it("should return true for gemini models", () => {
    expect(isAntigravityModel("gemini-pro")).toBe(true);
    expect(isAntigravityModel("google/gemini-1.5")).toBe(true);
  });

  it("should return true for claude models", () => {
    expect(isAntigravityModel("claude-3-opus")).toBe(true);
    expect(isAntigravityModel("anthropic.claude-v2")).toBe(true);
  });

  it("should return false for other models", () => {
    expect(isAntigravityModel("gpt-4")).toBe(false);
    expect(isAntigravityModel("gpt-3.5-turbo")).toBe(false);
    expect(isAntigravityModel("local-model")).toBe(false);
  });

  it("should return false for empty or null", () => {
    expect(isAntigravityModel("")).toBe(false);
    // @ts-ignore
    expect(isAntigravityModel(null)).toBe(false);
    // @ts-ignore
    expect(isAntigravityModel(undefined)).toBe(false);
  });
});
