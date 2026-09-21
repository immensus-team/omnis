// Persists the session/turn events the bridge raises as inbox rows (A2 §1.3 / §4.1, A3 §4).
// bridge.ts deals only with the wire; this file deals only with SQL.
import { one, query, tx } from "@omnis/db";
import { BRIDGE_ERRORS, BridgeError, type HostId, type RuntimeKind } from "@omnis/protocol";
import type { Pool } from "pg";

/**
 * A2 §1.3. Maps herdr's pane state model (idle/working/blocked/done — research/30 §1) onto the
 * agent_sessions.state CHECK values from 0004. Folding done and idle onto the same value is
 * intentional: "the turn finished" is a signal carried by the thread's last item, not by session
 * state, and the CHECK's 'ended' is reserved for session.close — reusing it would erase the
 * distinction from a closed session.
 */
export const HERDR_STATE = {
  idle: "idle",
  working: "running",
  blocked: "waiting_approval",
  done: "idle",
} as const satisfies Record<string, SessionStateValue>;

export type SessionStateValue =
  | "starting"
  | "idle"
  | "running"
  | "waiting_approval"
  | "ended"
  | "failed";

/** session_key = `agent:{runtime}:{host}:{purpose}` (A2-D1). */
export function purposeOf(sessionKey: string): string {
  return sessionKey.split(":")[3] ?? sessionKey;
}

/** turn.* notifications carry only the session_key — the runtime kind is read from the key (A2-D1). */
export function runtimeOf(sessionKey: string): string {
  return sessionKey.split(":")[1] ?? "";
}

/**
 * Runtime tool name → master §11 palette key (packages/ui TOOL_LABELS). ToolCallBadge throws on
 * an unknown name, so tools missing from the map fold to read — and since the palette has no
 * write-class tools, we cannot invent one here either.
 * ponytail: hardcoded table. Add rows as runtimes are added (master §11 prevents the palette
 * itself from changing).
 */
const TOOL_PALETTE: Readonly<Record<string, string>> = {
  Bash: "read",
  Read: "read",
  Glob: "read",
  Grep: "search_memory",
  WebSearch: "search_memory",
  shell: "read",
  read_file: "read",
};

export function paletteTool(raw: string): string {
  return TOOL_PALETTE[raw] ?? "read";
}

export interface SessionRow {
  id: string;
  threadId: string;
  accountId: string;
  runtimeId: string;
}

export interface EnsureSessionInput {
  runtime: RuntimeKind | string;
  host: HostId;
  sessionKey: string;
  cwd?: string | null;
  sessionId?: string | null;
  state?: SessionStateValue;
}

/**
 * Session = thread (A3 §4). Whether the hub opens it via session.create or the bridge announces
 * it via session.registered, both must converge on the same row, so there is a single entry point
 * — every statement here is an idempotent upsert.
 */
export async function ensureSession(pool: Pool, a: EnsureSessionInput): Promise<SessionRow> {
  return await tx(pool, async (c) => {
    const runtimes = await query<{ id: string }>(
      c,
      "SELECT id FROM agent_runtimes WHERE runtime = $1 AND host = $2",
      [a.runtime, a.host],
    );
    const runtimeId = runtimes[0]?.id;
    if (runtimeId === undefined) {
      throw new BridgeError(
        BRIDGE_ERRORS.RUNTIME_UNAVAILABLE,
        `runtime not registered: ${String(a.runtime)}@${a.host}`,
      );
    }
    const account = await one<{ id: string }>(
      c,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('agent', $1, $2)
         ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
       RETURNING id`,
      [`${String(a.runtime)}:${a.host}`, `${String(a.runtime)}@${a.host}`],
    );
    const thread = await one<{ id: string }>(
      c,
      `INSERT INTO threads (account_id, external_id, kind, title, last_item_at)
         VALUES ($1, $2, 'agent_session', $3, now())
         ON CONFLICT (account_id, external_id)
           DO UPDATE SET title = COALESCE(threads.title, EXCLUDED.title)
       RETURNING id`,
      [account.id, a.sessionKey, `${String(a.runtime)} · ${purposeOf(a.sessionKey)}`],
    );
    // The thread_id of an existing session is left alone: rotating session_id in the runtime
    // keeps both session_key and thread (A2-D1).
    const session = await one<{ id: string; thread_id: string }>(
      c,
      `INSERT INTO agent_sessions (runtime_id, thread_id, session_key, session_id, cwd, state)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (runtime_id, session_key) DO UPDATE
           SET session_id = COALESCE(EXCLUDED.session_id, agent_sessions.session_id),
               cwd = COALESCE(EXCLUDED.cwd, agent_sessions.cwd)
       RETURNING id, thread_id`,
      [
        runtimeId,
        thread.id,
        a.sessionKey,
        a.sessionId ?? null,
        a.cwd ?? null,
        a.state ?? "starting",
      ],
    );
    return { id: session.id, threadId: session.thread_id, accountId: account.id, runtimeId };
  });
}

export async function setSessionState(
  pool: Pool,
  runtimeId: string,
  sessionKey: string,
  state: SessionStateValue,
): Promise<void> {
  await query(
    pool,
    `UPDATE agent_sessions
        SET state = $3,
            last_turn_at = CASE WHEN $3 = 'running' THEN now() ELSE last_turn_at END
      WHERE runtime_id = $1 AND session_key = $2`,
    [runtimeId, sessionKey, state],
  );
}

/** The one check that keeps a session from dropping out of blocked into done (A2 §1.3). */
export async function hasPendingApproval(pool: Pool, threadId: string): Promise<boolean> {
  const rows = await query<{ one: number }>(
    pool,
    "SELECT 1 AS one FROM pending_approvals WHERE thread_id = $1 AND state = 'pending' LIMIT 1",
    [threadId],
  );
  return rows.length > 0;
}

export interface AgentItemInput {
  session: SessionRow;
  /** items.external_id. The same item arrives twice, started → completed, so it needs an idempotency key. */
  externalId: string;
  /** items.source_hash, the adapter-side idempotency key (0002). US-C16's import keys on the vendor's
   *  own turn id; the runtimes' live path leaves it unset. */
  sourceHash?: string | null;
  kind: "agent_turn" | "tool_call" | "system";
  body: string;
  tool: Record<string, unknown> | null;
}

/** Returns whether this call inserted the row rather than merging into one already there — the
 *  import job reports what arrived, and a merge is not an arrival. */
export async function writeAgentItem(pool: Pool, i: AgentItemInput): Promise<boolean> {
  return await tx(pool, async (c) => {
    // Do not overwrite body with an empty string: started has no body, completed fills it in.
    const rows = await query<{ inserted: boolean }>(
      c,
      `INSERT INTO items (thread_id, account_id, external_id, source_hash, kind, status,
                          author_agent_id, body, tool, sent_at)
         VALUES ($1, $2, $3, $4, $5, 'received', $6, $7, $8::jsonb, now())
         ON CONFLICT (account_id, external_id) WHERE external_id IS NOT NULL DO UPDATE
           SET body = COALESCE(NULLIF(EXCLUDED.body, ''), items.body),
               tool = COALESCE(EXCLUDED.tool, items.tool)
         RETURNING (xmax = 0) AS inserted`,
      [
        i.session.threadId,
        i.session.accountId,
        i.externalId,
        i.sourceHash ?? null,
        i.kind,
        i.session.runtimeId,
        i.body,
        i.tool === null ? null : JSON.stringify(i.tool),
      ],
    );
    await query(c, "UPDATE threads SET last_item_at = now() WHERE id = $1", [i.session.threadId]);
    return rows[0]?.inserted ?? false;
  });
}
