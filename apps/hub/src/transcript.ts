// GET /transcript/:session_id (delta spec §7). Returns a durable per-session summary:
// the session's stored `summary` text plus the last N turns read back from `items`.
// Raw model deltas/reasoning are never persisted (A2-D13), so there is nothing to
// reconstruct beyond the turn/tool_call items already in the inbox.
import { query } from "@omnis/db";
import { SessionKey, type SessionState, type SessionSummary } from "@omnis/protocol";
import type { Pool } from "pg";
import { purposeOf } from "./sessions.js";

export interface TranscriptSessionRow {
  id: string;
  session_key: string;
  runtime: string;
  host: string;
  state: string;
  summary: string | null;
  started_at: Date;
  last_turn_at: Date | null;
  turn_count: number;
}

export interface TranscriptItemRow {
  id: string;
  kind: string;
  body: string;
  tool: { label?: unknown; state?: unknown } | null;
  author_is_me: boolean;
  sent_at: Date;
}

/** agent_sessions.state has 6 values (0004 CHECK); the protocol's SessionState has 5 and uses different names. */
const STATE_MAP: Readonly<Record<string, SessionState>> = {
  starting: "idle",
  idle: "idle",
  running: "running",
  waiting_approval: "awaiting_approval",
  ended: "closed",
  failed: "failed",
};

export function toSessionState(dbState: string): SessionState {
  const mapped = STATE_MAP[dbState];
  // Collapsing an unknown value to "idle" would hide the difference between a
  // finished session and a brand-new state value we don't know about yet.
  if (mapped === undefined) throw new Error(`unknown agent_sessions.state: ${dbState}`);
  return mapped;
}

export const MAX_RECENT_TURNS = 10;
const MAX_TURN_TEXT = 1000;

export function clampLastN(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return MAX_RECENT_TURNS;
  return Math.min(MAX_RECENT_TURNS, Math.max(1, n));
}

/** `items` arrive in ascending sent_at order. A tool_call is not its own turn — it folds
 * into the **preceding** turn (A2 §3.3: reasoning/tool entries are a turn's attachments,
 * not items in their own right). If a tool_call arrives before any turn, there is nothing
 * to attach it to, so it is dropped — SessionSummary has no tool-only turns. */
export function buildSessionSummary(
  session: TranscriptSessionRow,
  items: readonly TranscriptItemRow[],
): SessionSummary {
  const turns: SessionSummary["recent_turns"] = [];
  for (const it of items) {
    if (it.kind === "tool_call") {
      const last = turns[turns.length - 1];
      if (last === undefined) continue;
      last.tool_calls.push({
        label: typeof it.tool?.label === "string" ? it.tool.label : "tool",
        status: it.tool?.state === "failed" ? "failed" : "ok",
      });
      continue;
    }
    turns.push({
      turn_id: it.id,
      at: it.sent_at.toISOString(),
      role: it.author_is_me ? "user" : "agent",
      text: it.body.slice(0, MAX_TURN_TEXT),
      tool_calls: [],
    });
  }
  return {
    session_key: SessionKey.parse(session.session_key),
    runtime: session.runtime as SessionSummary["runtime"],
    host: session.host as SessionSummary["host"],
    purpose: purposeOf(session.session_key),
    state: toSessionState(session.state),
    opened_at: session.started_at.toISOString(),
    last_turn_at: session.last_turn_at === null ? null : session.last_turn_at.toISOString(),
    turn_count: session.turn_count,
    summary: session.summary ?? "",
    open_questions: [],
    artifacts: [],
    recent_turns: turns.slice(-MAX_RECENT_TURNS),
  };
}

/** Returns null when the session does not exist so the route can answer 404. */
export async function loadTranscript(
  pool: Pool,
  sessionId: string,
  lastN: number,
): Promise<SessionSummary | null> {
  const sessions = await query<TranscriptSessionRow>(
    pool,
    `SELECT s.id, s.session_key, r.runtime, r.host, s.state, s.summary,
            s.started_at, s.last_turn_at,
            (SELECT count(*)::int FROM items i
              WHERE i.thread_id = s.thread_id AND i.kind = 'agent_turn') AS turn_count
       FROM agent_sessions s
       JOIN agent_runtimes r ON r.id = s.runtime_id
      WHERE s.id = $1`,
    [sessionId],
  );
  const session = sessions[0];
  if (session === undefined) return null;

  // To fill N turns we may need to pull interleaved tool_call rows too — over-fetch and
  // let buildSessionSummary() keep only the last N turns.
  // ponytail: fixed cap of N*8. If a single turn has more than 8 tool calls, an earlier
  // turn could get pushed out of the window. Raise the multiplier if that starts mattering.
  const rows = await query<TranscriptItemRow>(
    pool,
    `SELECT id, kind, body, tool, author_is_me, sent_at
       FROM (
         SELECT i.id, i.kind, i.body, i.tool, i.author_is_me, i.sent_at
           FROM items i
           JOIN agent_sessions s ON s.thread_id = i.thread_id
          WHERE s.id = $1 AND i.kind IN ('agent_turn', 'tool_call')
          ORDER BY i.sent_at DESC
          LIMIT $2
       ) recent
      ORDER BY sent_at ASC`,
    [sessionId, lastN * 8],
  );
  // buildSessionSummary() always keeps up to MAX_RECENT_TURNS (10); narrow to the caller's
  // requested lastN (<= 10) so `?last_n=1` actually returns one turn instead of up to 10.
  const summary = buildSessionSummary(session, rows);
  return { ...summary, recent_turns: summary.recent_turns.slice(-lastN) };
}
