// A4 §1.6·§12.4·§9: 실패와 정책 전이는 조용히 삼키지 않고 인박스에 남긴다.
// ponytail: 커널(@omnis/kernel)도 같은 INSERT를 필요로 하지만 agents를 의존할 수 없어 4줄짜리
// SQL을 각자 갖는다(apps/hub/src/archive.ts가 이미 같은 형태다). 의도된 중복 — 공용 패키지로 뽑지 않는다.
import { getAgentsPool } from "./pool.js";

export const SYSTEM_ACCOUNT_EXTERNAL_ID = "omnis";
export const SYSTEM_THREAD_EXTERNAL_ID = "system:agents";

export interface SystemItemInput {
  body: string;
  /** 없으면 system 채널의 단일 'system:agents' 스레드에 붙인다. */
  thread_id?: string;
  subject?: string;
  meta?: Record<string, unknown>;
}

/** system 채널 계정과 단일 스레드를 멱등하게 확보한다. */
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
