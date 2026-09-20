// A4 §1.6·§12.4·§9: failures and policy transitions are not swallowed silently — they are left in the inbox.
// ponytail: the kernel (@omnis/kernel) needs the same INSERT but cannot depend on agents, so each keeps
// its own 4-line SQL (apps/hub/src/archive.ts already looks the same). Intentional duplication — do not extract it into a shared package.
import { getAgentsPool } from "./pool.js";

export const SYSTEM_ACCOUNT_EXTERNAL_ID = "omnis";
export const SYSTEM_THREAD_EXTERNAL_ID = "system:agents";

export interface SystemItemInput {
  body: string;
  /** When omitted, the item is attached to the single 'system:agents' thread in the system channel. */
  thread_id?: string;
  subject?: string;
  meta?: Record<string, unknown>;
}

/** Idempotently ensures the system channel account and its single thread exist. */
async function systemThreadId(): Promise<string> {
  const pool = getAgentsPool();
  const acc = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display)
     VALUES ('system', $1, 'omnis')
     ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
     RETURNING id`,
    [SYSTEM_ACCOUNT_EXTERNAL_ID],
  );
  const accountId = acc.rows[0]?.id;
  if (accountId === undefined) throw new Error("system account upsert returned no row");
  const thr = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind, title)
     VALUES ($1, $2, 'system', 'omnis')
     ON CONFLICT (account_id, external_id) DO UPDATE SET kind = 'system'
     RETURNING id`,
    [accountId, SYSTEM_THREAD_EXTERNAL_ID],
  );
  const threadId = thr.rows[0]?.id;
  if (threadId === undefined) throw new Error("system thread upsert returned no row");
  return threadId;
}

export async function writeSystemItem(input: SystemItemInput): Promise<string> {
  const pool = getAgentsPool();
  const threadId = input.thread_id ?? (await systemThreadId());
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, kind, status, subject, body, sent_at, meta)
     SELECT $1, t.account_id, 'system', 'received', $2, $3, now(), $4::jsonb
       FROM threads t WHERE t.id = $1
     RETURNING id`,
    [threadId, input.subject ?? null, input.body, JSON.stringify(input.meta ?? {})],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`thread not found for system item: ${threadId}`);
  return id;
}
