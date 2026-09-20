// A4 §10.5 failure handling. Not failing silently is the rule of this design (A4 §1.6).
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
/** Upper bound on the retryAfterMs hint. GitHub's x-ratelimit-reset can point up to an hour
 *  ahead, and the scheduler's tick() runs job handlers sequentially, so sleeping that long here
 *  would stall everything, healthcheck included. Hints above the bound are clipped and left to
 *  the next tick. */
export const MAX_RETRY_AFTER_MS = 60_000;

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

/** Returns the cumulative fail_count. The caller compares it against DEAD_LETTER_THRESHOLD. */
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

/** A4 §10.5: API 5xx/network errors retry 3 times at 1s → 4s → 16s. Sources that report a reset
 *  time, like GitHub, can attach retryAfterMs to the error and that value is used. Nothing beyond
 *  that — the next tick will come. */
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
      await sleep(
        typeof hinted === "number"
          ? Math.min(hinted, MAX_RETRY_AFTER_MS)
          : (RETRY_BACKOFF_MS[attempt] ?? 1000),
      );
    }
  }
  throw lastError;
}

/** One system Item row (A4 §10.5 dead-letter, the same path as master §15). ingestion is not a
 *  channel, so it creates a dedicated system account and thread once and reuses them.
 *  ponytail: the same four-line INSERT as @omnis/agents' writeSystemItem, but contract §1 forbids
 *  a @omnis/memory → @omnis/agents dependency (kernel and apps/hub each carry their own too).
 *  Intentional duplication. */
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
