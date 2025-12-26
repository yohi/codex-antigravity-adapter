export type AuthSession = {
  stateId: string;
  codeVerifier: string;
  projectId?: string;
  createdAt: number;
};

export interface AuthSessionStore {
  save(session: AuthSession): void;
  get(stateId: string): AuthSession | null;
  delete(stateId: string): void;
}

type SessionStoreOptions = {
  ttlMs?: number;
  now?: () => number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class InMemoryAuthSessionStore implements AuthSessionStore {
  private ttlMs: number;
  private now: () => number;
  private sessions = new Map<string, { session: AuthSession; expiresAt: number }>();

  constructor(options: SessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  save(session: AuthSession): void {
    const createdAt = session.createdAt ?? this.now();
    const expiresAt = createdAt + this.ttlMs;
    this.sessions.set(session.stateId, {
      session: { ...session, createdAt },
      expiresAt,
    });
  }

  get(stateId: string): AuthSession | null {
    const entry = this.sessions.get(stateId);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= this.now()) {
      this.sessions.delete(stateId);
      return null;
    }
    return entry.session;
  }

  delete(stateId: string): void {
    this.sessions.delete(stateId);
  }
}
