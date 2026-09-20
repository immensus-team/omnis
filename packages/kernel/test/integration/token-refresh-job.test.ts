import { createPool, one, query } from "@omnis/db";
import {
  createEvents,
  createLogger,
  createScheduler,
  registerTokenRefreshJob,
} from "@omnis/kernel";
import type { Events, Scheduler } from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let pool: Pool;
let events: Events & { close(): Promise<void> };
let scheduler: Scheduler;
let accountId: string;

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
  // 0006 seed가 'token_refresh'를 next_run_at=now()(마이그레이션 적용 시각)로 미리 심어둔다(델타 §8).
  // scheduler.start()의 upsert는 기존 행의 next_run_at을 건드리지 않으므로(FIXED, scheduler.ts) 이 seed
  // 행을 지우지 않으면 start()의 최초 내부 tick이 "밀린 실행 따라잡기"로 즉시 한 번 돈다 — 뒤이어 테스트가
  // 의도적으로 next_run_at을 과거로 돌리는 것과 합쳐져 2회 호출된다. 매 실행마다 깨끗한 상태에서
  // 시작하도록 seed 행을 지운다(afterAll의 정리와 대칭).
  await query(pool, "DELETE FROM jobs WHERE name = 'token_refresh'");
  const account = await one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'expiring@x.com', 'x') RETURNING id`,
  );
  accountId = account.id;
  await query(
    pool,
    `INSERT INTO account_secrets (account_id, auth_ref, expires_at) VALUES ($1, 'omnis.outlook.expiring@x.com', now() + interval '5 minutes')`,
    [accountId],
  );
});
afterAll(async () => {
  await scheduler.stop();
  await query(pool, "DELETE FROM account_secrets WHERE account_id = $1", [accountId]);
  await query(pool, "DELETE FROM accounts WHERE id = $1", [accountId]);
  await query(pool, "DELETE FROM jobs WHERE name = 'token_refresh'");
  await events.close();
  await pool.end();
});

describe("token_refresh job", () => {
  it("calls the injected refresher for accounts whose secret expires within the window", async () => {
    const refresher = vi.fn(async () => {});
    scheduler = createScheduler({
      pool,
      events,
      logger: createLogger("@omnis/kernel"),
      tickMs: 50,
    });
    registerTokenRefreshJob(scheduler, {
      pool,
      logger: createLogger("@omnis/kernel"),
      refreshers: { outlook: refresher },
      windowMinutes: 60,
    });
    await scheduler.start();
    await query(
      pool,
      `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'token_refresh'`,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(refresher).toHaveBeenCalledOnce();
    const [auth] = refresher.mock.calls[0] as [
      { channel: string; accountExternalId: string; keychainService: string },
    ];
    expect(auth.channel).toBe("outlook");
    expect(auth.accountExternalId).toBe("expiring@x.com");
    expect(auth.keychainService).toBe("omnis.outlook.expiring@x.com");
  });
});
