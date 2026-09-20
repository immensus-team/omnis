// A4 §3.6: the batched tier collapses into a single "N drafts ready" every 3 hours.
import { query } from "@omnis/db";
import type { NotifyTier, PushPayload } from "@omnis/protocol";
import type { Pool } from "pg";
import type { Logger } from "../logger.js";
import type { Scheduler } from "../scheduler.js";

export const PUSH_BATCH_JOB_NAME = "push_batch";
export const PUSH_BATCH_CRON = "0 9,12,15,18 * * *";

export interface Notifier {
  send(p: PushPayload, tier: NotifyTier): Promise<void>;
}

/** A4 §3.6 privacy rule: never put the full body on the lock screen. */
export function first80(s: string): string {
  return s.length <= 80 ? s : s.slice(0, 80);
}

export interface PushBatchDeps {
  pool: Pool;
  logger: Logger;
  notifier: Notifier;
  now?: Date;
}

export async function runPushBatch(deps: PushBatchDeps): Promise<number> {
  const { pool, notifier, logger } = deps;
  const rows = await query<{ n: string; thread_id: string | null }>(
    pool,
    // Postgres has no min(uuid) (aggregate undefined) — cast to text and aggregate that.
    `SELECT count(*)::text AS n, min(thread_id::text) AS thread_id
       FROM items WHERE status = 'draft' AND (meta->>'pending') IS DISTINCT FROM 'true'`,
  );
  const n = Number(rows[0]?.n ?? "0");
  if (n === 0) return 0;
  const threadId = rows[0]?.thread_id ?? "";
  await notifier.send(
    {
      kind: "draft",
      title: "omnis",
      body: first80(`${n} drafts ready`),
      deep_link: threadId === "" ? "omnis://inbox" : `omnis://thread/${threadId}`,
    },
    "batched",
  );
  logger.info("push batch sent", { drafts: n });
  return n;
}

export function registerPushBatchJob(scheduler: Scheduler, deps: PushBatchDeps): void {
  scheduler.register(PUSH_BATCH_JOB_NAME, PUSH_BATCH_CRON, async () => {
    await runPushBatch(deps);
  });
}

/** The real sender is the Web Push + Tauri local notification from Task 12. This only creates the
 *  injection point. */
export function createNotifier(deps: {
  pool: Pool;
  logger: Logger;
  send: (p: PushPayload, tier: NotifyTier) => Promise<void>;
}): Notifier {
  return {
    async send(p, tier) {
      if (tier === "silent") return;
      try {
        await deps.send(p, tier);
      } catch (e) {
        // A4: a send failure is never swallowed. A system Item, not an agent_run (backlog US-B17).
        deps.logger.error("notify send failed", {
          kind: p.kind,
          err: e instanceof Error ? e.message : String(e),
        });
        await query(
          deps.pool,
          `WITH acc AS (
             INSERT INTO accounts (channel, external_id, display) VALUES ('system','omnis','omnis')
             ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display RETURNING id),
           thr AS (
             INSERT INTO threads (account_id, external_id, kind, title)
             SELECT id, 'system:agents', 'system', 'omnis' FROM acc
             ON CONFLICT (account_id, external_id) DO UPDATE SET kind = 'system' RETURNING id, account_id)
           INSERT INTO items (thread_id, account_id, kind, status, body, sent_at)
           SELECT thr.id, thr.account_id, 'system', 'received', $1, now() FROM thr`,
          [`Notification send failed (${p.kind}). Check your push subscription in Settings.`],
        );
      }
    },
  };
}
