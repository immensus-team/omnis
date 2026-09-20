// 브리지가 올린 세션·턴 이벤트를 인박스 row로 영속화하는 곳(A2 §1.3 / §4.1, A3 §4).
// bridge.ts는 와이어만 다루고, 여기는 SQL만 다룬다.
import { one, query, tx } from "@omnis/db";
import { BRIDGE_ERRORS, BridgeError, type HostId, type RuntimeKind } from "@omnis/protocol";
import type { Pool } from "pg";

/**
 * A2 §1.3. herdr의 pane 상태 모델(idle/working/blocked/done — research/30 §1)을 0004의
 * agent_sessions.state CHECK 값에 얹는다. done과 idle이 같은 값으로 접히는 것은 의도다:
 * "턴이 끝났다"는 신호는 스레드의 마지막 item이지 세션 상태가 아니고, CHECK의 'ended'는
 * 세션 종료(session.close) 자리라 재사용하면 닫힌 세션과 구분이 사라진다.
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

/** turn.* 알림은 session_key만 싣는다 — 런타임 종류는 키에서 읽는다(A2-D1). */
export function runtimeOf(sessionKey: string): string {
  return sessionKey.split(":")[1] ?? "";
}

/**
 * 런타임 tool 이름 → master §11 팔레트 키(packages/ui TOOL_LABELS). ToolCallBadge는 모르는
 * 이름에 throw하므로 매핑에 없는 도구는 읽기로 접는다 — 팔레트에 쓰기 계열 도구가 없어서
 * 여기서 만들어 낼 수도 없다.
 * ponytail: 하드코딩 표. 런타임이 늘면 표를 늘린다(팔레트 자체가 바뀔 일은 master §11이 막는다).
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
 * 세션 = thread(A3 §4). 허브가 session.create로 열든 브리지가 session.registered로 알려 오든
 * 같은 row에 수렴해야 하므로 입구를 하나로 둔다 — 전부 멱등 upsert다.
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
    // 이미 있는 세션의 thread_id는 건드리지 않는다: 런타임이 session_id를 회전시켜도
    // session_key와 thread는 유지된다(A2-D1).
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

/** blocked에서 done으로 내려가지 않게 하는 유일한 판정(A2 §1.3). */
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
  /** items.external_id. 같은 item이 started → completed로 두 번 오므로 멱등 키가 필요하다. */
  externalId: string;
  kind: "agent_turn" | "tool_call" | "system";
  body: string;
  tool: Record<string, unknown> | null;
}

export async function writeAgentItem(pool: Pool, i: AgentItemInput): Promise<void> {
  await tx(pool, async (c) => {
    // body를 빈 문자열로 덮어쓰지 않는다: started는 body가 없고 completed가 채운다.
    await query(
      c,
      `INSERT INTO items (thread_id, account_id, external_id, kind, status, author_agent_id,
                          body, tool, sent_at)
         VALUES ($1, $2, $3, $4, 'received', $5, $6, $7::jsonb, now())
         ON CONFLICT (account_id, external_id) WHERE external_id IS NOT NULL DO UPDATE
           SET body = COALESCE(NULLIF(EXCLUDED.body, ''), items.body),
               tool = COALESCE(EXCLUDED.tool, items.tool)`,
      [
        i.session.threadId,
        i.session.accountId,
        i.externalId,
        i.kind,
        i.session.runtimeId,
        i.body,
        i.tool === null ? null : JSON.stringify(i.tool),
      ],
    );
    await query(c, "UPDATE threads SET last_item_at = now() WHERE id = $1", [i.session.threadId]);
  });
}
