import { describe, expect, it } from "bun:test";

import { SignatureCache, hashThinkingText } from "../src/transformer/helpers";

describe("SignatureCache", () => {
  it("evicts least recently used entries when max size is exceeded", () => {
    const cache = new SignatureCache({ maxSize: 2, now: () => 0 });
    const sessionId = "session-lru";

    const hashA = hashThinkingText("A");
    const hashB = hashThinkingText("B");
    const hashC = hashThinkingText("C");

    cache.set({
      sessionId,
      textHash: hashA,
      signature: { type: "thinking", thinking: "A", signature: "sig-a" },
    });
    cache.set({
      sessionId,
      textHash: hashB,
      signature: { type: "thinking", thinking: "B", signature: "sig-b" },
    });

    cache.get(sessionId, hashA);

    cache.set({
      sessionId,
      textHash: hashC,
      signature: { type: "thinking", thinking: "C", signature: "sig-c" },
    });

    expect(cache.get(sessionId, hashB)).toBeNull();
    expect(cache.get(sessionId, hashA)?.signature).toEqual({
      type: "thinking",
      thinking: "A",
      signature: "sig-a",
    });
  });

  it("drops expired entries on access", () => {
    let now = 0;
    const cache = new SignatureCache({
      ttlMs: 1000,
      now: () => now,
    });
    const sessionId = "session-ttl";
    const hash = hashThinkingText("Expired");

    cache.set({
      sessionId,
      textHash: hash,
      signature: { type: "thinking", thinking: "Expired", signature: "sig" },
    });

    now = 2000;

    expect(cache.get(sessionId, hash)).toBeNull();
    expect(cache.getLatest(sessionId)).toBeNull();
  });
});
