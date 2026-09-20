import { one, query, tx } from "@omnis/db";
import type { Channel } from "@omnis/protocol";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "./logger.js";

// ponytail: pinned at N=3 consecutive failures (A1 §1.5 uses "sustained for 5 minutes" as its
// criterion, but this function is a generic counter of polling calls — polling intervals differ
// per channel, so we count calls, not time). If that proves too noisy or too blunt, promote it to
// a per-channel setting next to settings.notify.* (B-D2 kv pattern).
export const ADAPTER_HEALTH_FAIL_THRESHOLD = 3;

const SYSTEM_ACCOUNT_EXTERNAL_ID = "omnis-system";
const SYSTEM_THREAD_EXTERNAL_ID = "adapter-health";

// ponytail: an in-process Map — the counters reset when the hub restarts. That is the trade we
// made for not adding a column to accounts (delta §6 "no column changes to accounts"). A brief
// re-count right after a restart stays inside the false-positive budget of "3 in a row".
const consecutiveFailures = new Map<Channel, number>();

export function resetAdapterHealthCounters(): void {
  consecutiveFailures.clear();
}

export interface NtfyDeps {
  url?: string;
  topic?: string;
  fetchFn?: typeof fetch;
}

/** A6 §8: self-hosted ntfy, one line of `curl -d "message" <url>/<topic>`. Skip silently when url
 *  is unset — ntfy may not exist yet during early mini boot, and the system Item side of the dual
 *  exposure always runs. */
export async function sendNtfy(deps: NtfyDeps, message: string): Promise<void> {
  if (deps.url === undefined) return;
  const fetchFn = deps.fetchFn ?? fetch;
  await fetchFn(`${deps.url.replace(/\/$/, "")}/${deps.topic ?? "omnis-warning"}`, {
    method: "POST",
    body: message,
  });
}

async function ensureSystemThread(c: PoolClient): Promise<{ accountId: string; threadId: string }> {
  const account = await one<{ id: string }>(
    c,
    `INSERT INTO accounts (channel, external_id, display, state)
       VALUES ('system', $1, 'omnis system', 'active')
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
       RETURNING id`,
    [SYSTEM_ACCOUNT_EXTERNAL_ID],
  );
  const thread = await one<{ id: string }>(
    c,
    `INSERT INTO threads (account_id, external_id, kind, title)
       VALUES ($1, $2, 'system', 'Adapter status')
       ON CONFLICT (account_id, external_id) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
    [account.id, SYSTEM_THREAD_EXTERNAL_ID],
  );
  return { accountId: account.id, threadId: thread.id };
}

export interface AdapterHealthDeps {
  pool: Pool;
  logger: Logger;
  ntfy?: NtfyDeps;
}

/** Generic implementation of the A1 §1.5 + A6 §8 principle. Once ok=false arrives
 *  ADAPTER_HEALTH_FAIL_THRESHOLD times in a row: accounts.state='broken' + items(kind='system') +
 *  ntfy dual exposure (A6 §8). ok=true resets the counter and restores broken ones to active. */
export async function recordAdapterHealth(
  deps: AdapterHealthDeps,
  channel: Channel,
  ok: boolean,
  error?: string,
): Promise<void> {
  const { pool, logger } = deps;
  if (ok) {
    consecutiveFailures.set(channel, 0);
    await query(
      pool,
      `UPDATE accounts SET state = 'active', last_health_at = now(), last_error = NULL
        WHERE channel = $1 AND state = 'broken'`,
      [channel],
    );
    return;
  }

  const n = (consecutiveFailures.get(channel) ?? 0) + 1;
  consecutiveFailures.set(channel, n);
  await query(
    pool,
    "UPDATE accounts SET last_health_at = now(), last_error = $2 WHERE channel = $1",
    [channel, error ?? null],
  );
  if (n < ADAPTER_HEALTH_FAIL_THRESHOLD) return;

  const message = `${channel} connection lost (${n} consecutive failures): ${error ?? "unknown"}`;
  await tx(pool, async (c) => {
    await query(c, `UPDATE accounts SET state = 'broken', last_error = $2 WHERE channel = $1`, [
      channel,
      error ?? null,
    ]);
    const { accountId, threadId } = await ensureSystemThread(c);
    await query(
      c,
      `INSERT INTO items (thread_id, account_id, kind, body, sent_at) VALUES ($1, $2, 'system', $3, now())`,
      [threadId, accountId, message],
    );
  });
  logger.error("adapter health threshold exceeded", { channel, consecutive: n, error });
  await sendNtfy(deps.ntfy ?? {}, `[omnis] ${message}`);
}
