import { describe, it, expect } from "bun:test";
import { shouldRouteToOpenAI } from "../../src/proxy/route-utils";

describe("shouldRouteToOpenAI", () => {
  it("routes gemini models to Antigravity", () => {
    expect(shouldRouteToOpenAI("gemini-1.5-pro")).toBe(false);
    expect(shouldRouteToOpenAI("GeMiNi-3-flash")).toBe(false);
  });

  it("routes claude models to Antigravity", () => {
    expect(shouldRouteToOpenAI("claude-3-opus")).toBe(false);
    expect(shouldRouteToOpenAI("Claude-Sonnet")).toBe(false);
  });

  it("routes non-gemini/claude models to OpenAI", () => {
    expect(shouldRouteToOpenAI("gpt-4-turbo")).toBe(true);
    expect(shouldRouteToOpenAI("o1-mini")).toBe(true);
  });
});
