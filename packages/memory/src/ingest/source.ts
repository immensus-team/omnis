// A4 §10.5 실패 처리. 조용히 실패하지 않는 것이 이 설계의 규칙이다(A4 §1.6).
import { one, query } from "@omnis/db";
import type { MemorySourceKind } from "@omnis/protocol";
import type { Pool } from "pg";

export interface IngestSource {
  id: string;
  source_kind: MemorySourceKind;
  source_ref: string;
  cursor: Record<string, unknown>;
  last_ok_at: string | null;
  fail_count: number;
  last_error: string | null;
}

export const DEAD_LETTER_THRESHOLD = 3;
export const RETRY_BACKOFF_MS: readonly number[] = [1000, 4000, 16000];

interface RawSource extends Omit<IngestSource, "last_ok_at"> {
  last_ok_at: Date | null;
}

function toSource(r: RawSource): IngestSource {
  return { ...r, last_ok_at: r.last_ok_at === null ? null : r.last_ok_at.toISOString() };
}

export async function getSource(
  pool: Pool,
  kind: MemorySourceKind,
  ref: string,
): Promise<IngestSource> {
  const row = await one<RawSource>(
    pool,
    `INSERT INTO ingest_sources (source_kind, source_ref) VALUES ($1, $2)
       ON CONFLICT (source_kind, source_ref) DO UPDATE SET source_ref = EXCLUDED.source_ref
       RETURNING id, source_kind, source_ref, cursor, last_ok_at, fail_count, last_error`,
    [kind, ref],
  );
  return toSource(row);
}

export async function saveCursor(
  pool: Pool,
  id: string,
  cursor: Record<string, unknown>,
): Promise<void> {
  await query(pool, "UPDATE ingest_sources SET cursor = $2::jsonb WHERE id = $1", [
    id,
    JSON.stringify(cursor),
  ]);
}

export async function recordSuccess(pool: Pool, id: string): Promise<void> {
  await query(
    pool,
    "UPDATE ingest_sources SET last_ok_at = now(), fail_count = 0, last_error = NULL WHERE id = $1",
    [id],
  );
}

/** 누적 fail_count를 돌려준다. 호출자가 DEAD_LETTER_THRESHOLD와 비교한다. */
export async function recordFailure(pool: Pool, id: string, error: string): Promise<number> {
  const row = await one<{ fail_count: number }>(
    pool,
    `UPDATE ingest_sources SET fail_count = fail_count + 1, last_error = $2
      WHERE id = $1 RETURNING fail_count`,
    [id, error.slice(0, 1000)],
  );
  return row.fail_count;
}

export interface RetryDeps {
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms).unref?.();
  });

/** A4 §10.5: API 5xx/네트워크는 1s → 4s → 16s로 3회. GitHub처럼 리셋 시각을 알려주는 쪽은
 *  에러에 retryAfterMs를 실어 보내면 그 값을 쓴다. 그 이상은 하지 않는다 — 다음 틱이 온다. */
export async function withRetry<T>(fn: () => Promise<T>, deps: RetryDeps = {}): Promise<T> {
  const sleep = deps.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === RETRY_BACKOFF_MS.length) break;
      const hinted = (e as { retryAfterMs?: unknown }).retryAfterMs;
      await sleep(typeof hinted === "number" ? hinted : (RETRY_BACKOFF_MS[attempt] ?? 1000));
    }
  }
  throw lastError;
}

/** 시스템 Item 한 행(A4 §10.5 dead-letter, 마스터 §15와 같은 경로). ingestion은 채널이 아니므로
 *  전용 system 계정·스레드를 한 번 만들어 재사용한다.
 *  ponytail: @omnis/agents의 writeSystemItem과 같은 4줄짜리 INSERT지만 계약 §1이
 *  @omnis/memory → @omnis/agents 의존을 금지한다(커널·apps/hub도 각자 갖고 있다). 의도된 중복. */
export async function writeIngestSystemItem(
  pool: Pool,
  i: { subject: string; body: string },
): Promise<string> {
  const account = await one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display)
       VALUES ('system', 'omnis-ingest', 'omnis ingestion')
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
       RETURNING id`,
  );
  const thread = await one<{ id: string }>(
    pool,
    `INSERT INTO threads (account_id, external_id, kind, title)
       VALUES ($1, 'ingest', 'system', 'ingestion')
       ON CONFLICT (account_id, external_id) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
    [account.id],
  );
  const item = await one<{ id: string }>(
    pool,
    `INSERT INTO items (thread_id, account_id, kind, status, subject, body, sent_at)
       VALUES ($1, $2, 'system', 'received', $3, $4, now())
       RETURNING id`,
    [thread.id, account.id, i.subject, i.body],
  );
  return item.id;
}
