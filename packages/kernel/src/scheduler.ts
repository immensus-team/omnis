import { query } from "@omnis/db";
import type { Pool } from "pg";
import { nextRunAt } from "./cron.js";
import type { Events } from "./events.js";
import type { Logger } from "./logger.js";

export interface Scheduler {
  register(name: string, cron: string, handler: () => Promise<void>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface SchedulerDeps {
  pool: Pool;
  events: Events;
  logger: Logger;
  now?: () => Date;
  /** 기본 10초(계약 §5). 테스트만 줄인다. */
  tickMs?: number;
  /** 마스터 §7: kill switch 하나로 모든 자율 루프가 멈춘다. 스케줄러 틱이 Phase A의 유일한 자율 루프다.
   *  이미 claim된 잡은 끝까지 돌고, 다음 틱부터 멈춘다. 없으면 항상 꺼진 것으로 본다. */
  isKillSwitchOn?: () => Promise<boolean>;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { pool, events, logger } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const tickMs = deps.tickMs ?? 10_000;
  const isKillSwitchOn = deps.isKillSwitchOn ?? ((): Promise<boolean> => Promise.resolve(false));

  const handlers = new Map<string, () => Promise<void>>();
  const schedules = new Map<string, string>();
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let ticking = false;

  async function runOne(name: string, handler: () => Promise<void>): Promise<void> {
    // 계약 §5의 claim 문장 그대로. 0행이면 다른 틱/프로세스가 이미 잡았거나 아직 때가 아니다.
    const claimed = await query<{ id: string; schedule: string }>(
      pool,
      `UPDATE jobs SET claimed_at = now()
        WHERE name = $1 AND claimed_at IS NULL AND enabled AND next_run_at <= now()
        RETURNING id, schedule`,
      [name],
    );
    const job = claimed[0];
    if (job === undefined) return;

    const startedAt = Date.now();
    let status: "ok" | "failed" = "ok";
    let error: string | null = null;
    try {
      await handler();
    } catch (e) {
      status = "failed";
      error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      logger.error("job failed", { name, err: error });
    }
    await query(
      pool,
      `UPDATE jobs SET last_run_at = now(), last_status = $2, last_error = $3,
                       next_run_at = $4, claimed_at = NULL
        WHERE id = $1`,
      [job.id, status, error, nextRunAt(job.schedule, now())],
    );
    await events.emit("cold", "job.run", {
      id: job.id,
      name,
      status,
      latency_ms: Date.now() - startedAt,
      actor: "system",
      target_table: "jobs",
      ...(error !== null ? { error } : {}),
    });
  }

  async function tick(): Promise<void> {
    if (!running || ticking) return;
    ticking = true;
    try {
      if (await isKillSwitchOn()) {
        logger.warn("scheduler tick skipped: kill switch is on");
        return;
      }
      for (const [name, handler] of handlers) {
        await runOne(name, handler);
      }
    } catch (e) {
      logger.error("scheduler tick failed", {
        err: e instanceof Error ? e.message : String(e),
      });
    } finally {
      ticking = false;
    }
  }

  return {
    register(name, cron, handler) {
      nextRunAt(cron, now()); // 잘못된 cron은 등록 시점에 터진다
      handlers.set(name, handler);
      schedules.set(name, cron);
    },

    async start() {
      for (const [name, cron] of schedules) {
        await query(
          pool,
          `INSERT INTO jobs (name, schedule, next_run_at) VALUES ($1, $2, $3)
             ON CONFLICT (name) DO UPDATE SET schedule = EXCLUDED.schedule`,
          [name, cron, nextRunAt(cron, now())],
        );
      }
      running = true;
      timer = setInterval(() => {
        void tick();
      }, tickMs);
      timer.unref();
      await tick();
    },

    async stop() {
      running = false;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      // 진행 중인 틱이 claimed_at을 들고 끝나도록 잠깐 기다린다.
      for (let i = 0; i < 100 && ticking; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
    },
  };
}
