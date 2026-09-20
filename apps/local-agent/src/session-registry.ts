import {
  BRIDGE_ERRORS,
  BridgeError,
  type PermissionProfile,
  type RuntimeKind,
  type SessionOrigin,
  type SessionState,
} from "@omnis/protocol";

export interface SessionRecord {
  session_key: string;
  session_id: string | null;
  runtime: RuntimeKind;
  runtime_id: string;
  cwd: string;
  purpose: string;
  origin: SessionOrigin;
  permission_profile: PermissionProfile;
  state: SessionState;
  opened_at: string;
  last_turn_at: string | null;
}

export type SessionCreateInput = Omit<SessionRecord, "session_id" | "state" | "last_turn_at">;

/** The bridge manages only the sessions it created (A2 §2.3). Nothing is persisted to disk. */
export class SessionRegistry {
  readonly #byKey = new Map<string, SessionRecord>();

  create(input: SessionCreateInput): SessionRecord {
    const existing = this.#byKey.get(input.session_key);
    if (existing !== undefined) return existing;
    const rec: SessionRecord = { ...input, session_id: null, state: "idle", last_turn_at: null };
    this.#byKey.set(rec.session_key, rec);
    return rec;
  }

  get(key: string): SessionRecord | undefined {
    return this.#byKey.get(key);
  }

  require(key: string): SessionRecord {
    const rec = this.#byKey.get(key);
    if (rec === undefined)
      throw new BridgeError(BRIDGE_ERRORS.SESSION_NOT_FOUND, `unknown session_key: ${key}`, {
        session_key: key,
      });
    return rec;
  }

  /** When the runtime starts a new session only this value changes. session_key and thread are kept. */
  bindSessionId(key: string, sessionId: string): SessionRecord {
    const rec = this.require(key);
    rec.session_id = sessionId;
    return rec;
  }

  setState(key: string, state: SessionState, at?: string): SessionRecord {
    const rec = this.require(key);
    rec.state = state;
    if (state === "running" && at !== undefined) rec.last_turn_at = at;
    return rec;
  }

  close(key: string): void {
    this.setState(key, "closed");
  }

  list(): SessionRecord[] {
    return [...this.#byKey.values()];
  }
}
