import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

const packageJsonUrl = new URL("../package.json", import.meta.url);

describe("CI dependencies", () => {
  it("includes Biome in devDependencies", async () => {
    const raw = await readFile(packageJsonUrl, "utf8");
    const pkg = JSON.parse(raw) as {
      devDependencies?: Record<string, string>;
    };
    const version = pkg.devDependencies?.["@biomejs/biome"];

    expect(typeof version).toBe("string");
    expect(version?.length ?? 0).toBeGreaterThan(0);
  });
});
