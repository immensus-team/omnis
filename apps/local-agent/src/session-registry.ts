import {
  BRIDGE_ERRORS, BridgeError,
  type PermissionProfile, type RuntimeKind, type SessionOrigin, type SessionState,
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

/** 브리지는 자기가 만든 세션만 관리한다(A2 §2.3). 디스크에 영속화하지 않는다. */
export class SessionRegistry {
  readonly #byKey = new Map<string, SessionRecord>();

  create(input: SessionCreateInput): SessionRecord {
    const existing = this.#byKey.get(input.session_key);
    if (existing !== undefined) return existing;
    const rec: SessionRecord = { ...input, session_id: null, state: "idle", last_turn_at: null };
    this.#byKey.set(rec.session_key, rec);
    return rec;
  }

  get(key: string): SessionRecord | undefined { return this.#byKey.get(key); }

  require(key: string): SessionRecord {
    const rec = this.#byKey.get(key);
    if (rec === undefined) throw new BridgeError(BRIDGE_ERRORS.SESSION_NOT_FOUND, `unknown session_key: ${key}`, { session_key: key });
    return rec;
  }

  /** 런타임이 세션을 새로 만들면 이 값만 바뀐다. session_key와 thread는 유지된다. */
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

  close(key: string): void { this.setState(key, "closed"); }

  list(): SessionRecord[] { return [...this.#byKey.values()]; }
}
