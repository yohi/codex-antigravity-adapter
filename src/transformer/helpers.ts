import { createHash, randomUUID } from "crypto";

export const DEFAULT_SIGNATURE_CACHE_MAX_SIZE = 512;
export const DEFAULT_SIGNATURE_CACHE_TTL_MS = 10 * 60 * 1000;

export type SignatureBlock = Record<string, unknown>;

export type SignatureCacheEntry = {
  sessionId: string;
  textHash: string;
  signature: SignatureBlock;
  createdAt: number;
  expiresAt: number;
};

export type SignatureCacheOptions = {
  maxSize?: number;
  ttlMs?: number;
  now?: () => number;
};

export class SignatureCache {
  private cache = new Map<string, SignatureCacheEntry>();
  private maxSize: number;
  private ttlMs: number;
  private now: () => number;

  constructor(options: SignatureCacheOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_SIGNATURE_CACHE_MAX_SIZE;
    this.ttlMs = options.ttlMs ?? DEFAULT_SIGNATURE_CACHE_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  set(entry: { sessionId: string; textHash: string; signature: SignatureBlock }) {
    const key = buildSignatureKey(entry.sessionId, entry.textHash);
    const createdAt = this.now();
    const cacheEntry: SignatureCacheEntry = {
      sessionId: entry.sessionId,
      textHash: entry.textHash,
      signature: entry.signature,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };

    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, cacheEntry);
    this.evictIfNeeded();
  }

  get(sessionId: string, textHash: string): SignatureCacheEntry | null {
    const key = buildSignatureKey(sessionId, textHash);
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  getLatest(sessionId: string): SignatureCacheEntry | null {
    const entries = Array.from(this.cache.entries()).reverse();
    for (const [key, entry] of entries) {
      if (entry.sessionId !== sessionId) {
        continue;
      }
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        continue;
      }
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry;
    }
    return null;
  }

  pruneExpired(): void {
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
      }
    }
  }

  private isExpired(entry: SignatureCacheEntry): boolean {
    return entry.expiresAt <= this.now();
  }

  private evictIfNeeded() {
    while (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) {
        return;
      }
      this.cache.delete(oldestKey);
    }
  }
}

export function hashThinkingText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function isThinkingBlock(value: unknown): value is SignatureBlock {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.thought === true) {
    return true;
  }
  const type = typeof record.type === "string" ? record.type : null;
  if (type && (type === "thinking" || type === "redacted_thinking" || type === "reasoning")) {
    return true;
  }
  return (
    typeof record.signature === "string" || typeof record.thoughtSignature === "string"
  );
}

export function getThinkingText(block: SignatureBlock): string {
  const candidates = ["thinking", "reasoning", "text", "content"];
  for (const key of candidates) {
    const value = block[key];
    if (typeof value === "string") {
      return value;
    }
  }
  try {
    return JSON.stringify(block);
  } catch {
    return "";
  }
}

export function stripThinkingBlocksFromMessages(
  messages: unknown[]
): { messages: unknown[]; textHash?: string } {
  const hashes: string[] = [];
  const stripped = messages.map((message) => {
    if (!message || typeof message !== "object") {
      return message;
    }
    const record = message as Record<string, unknown>;
    if (!Array.isArray(record.content)) {
      return message;
    }
    return {
      ...record,
      content: stripThinkingBlocksFromArray(record.content, hashes),
    };
  });

  const textHash = hashes.length > 0 ? hashes[hashes.length - 1] : undefined;
  return { messages: stripped, textHash };
}

export function resolveSignatureEntry(
  cache: SignatureCache,
  sessionId: string,
  textHash?: string
): SignatureCacheEntry | null {
  if (textHash) {
    const entry = cache.get(sessionId, textHash);
    if (entry) {
      return entry;
    }
  }
  return cache.getLatest(sessionId);
}

export const DEFAULT_SIGNATURE_CACHE = new SignatureCache();
export const SESSION_ID = randomUUID();

function stripThinkingBlocksFromArray(items: unknown[], hashes: string[]): unknown[] {
  const cleaned: unknown[] = [];
  for (const item of items) {
    if (isThinkingBlock(item)) {
      hashes.push(hashThinkingText(getThinkingText(item)));
      continue;
    }
    if (Array.isArray(item)) {
      cleaned.push(stripThinkingBlocksFromArray(item, hashes));
      continue;
    }
    if (item && typeof item === "object") {
      cleaned.push(stripThinkingBlocksFromObject(item as Record<string, unknown>, hashes));
      continue;
    }
    cleaned.push(item);
  }
  return cleaned;
}

function stripThinkingBlocksFromObject(
  obj: Record<string, unknown>,
  hashes: string[]
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      cleaned[key] = stripThinkingBlocksFromArray(value, hashes);
      continue;
    }
    if (value && typeof value === "object") {
      if (isThinkingBlock(value)) {
        hashes.push(hashThinkingText(getThinkingText(value)));
        continue;
      }
      cleaned[key] = stripThinkingBlocksFromObject(value as Record<string, unknown>, hashes);
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

function buildSignatureKey(sessionId: string, textHash: string): string {
  return `${sessionId}:${textHash}`;
}
