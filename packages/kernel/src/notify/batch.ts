// A4 §3.6: 묶음 등급은 3시간 간격으로 "초안 N건 준비됨" 1건으로 접힌다.
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

/** A4 §3.6 프라이버시 원칙: 잠금화면에 본문 전문을 띄우지 않는다. */
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
    // min(uuid)는 Postgres에 없다(집계 미정의) — text로 캐스트해서 집계한다.
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
      body: first80(`초안 ${n}건 준비됨`),
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

/** 실제 발송기는 Task 12의 Web Push + Tauri 로컬 알림이다. 여기서는 주입 지점만 만든다. */
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
        // A4: 발송 실패를 조용히 삼키지 않는다. agent_runs가 아니라 시스템 Item이다(백로그 US-B17).
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
          [`알림 발송에 실패했습니다(${p.kind}). 설정에서 푸시 구독을 확인해 주세요.`],
        );
      }
    },
  };
}
