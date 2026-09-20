import { createPool, one, query } from "@omnis/db";
import {
  type Events,
  type KillSwitch,
  type Scheduler,
  createAudit,
  createEvents,
  createKillSwitch,
  createLogger,
  createScheduler,
} from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let events: Events & { close(): Promise<void> };
let killSwitch: KillSwitch;
let scheduler: Scheduler;
let runs = 0;
const logger = createLogger("@omnis/kernel");

/** 틱(50ms)이 게이트를 이미 지나 in-flight인 창을 닫는다. 이 시간이 지나면 남은 틱이 없다. */
const SETTLE_MS = 150;
/** 테스트 창(400ms) 안에서 cron이 스스로 다시 due가 되면 안 된다 — due는 아래 UPDATE로만 만든다. */
const NEVER_IN_A_TEST_WINDOW = "0 4 * * *";

async function makeDue(): Promise<void> {
  await query(
    pool,
    `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name='test_killable'`,
  );
}

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger });
  killSwitch = createKillSwitch({ pool, events, audit: createAudit(pool), logger });
  await killSwitch.set(false, "test start");
  scheduler = createScheduler({
    pool,
    events,
    logger,
    tickMs: 50,
    isKillSwitchOn: () => killSwitch.isOn(),
  });
  scheduler.register("test_killable", NEVER_IN_A_TEST_WINDOW, async () => {
    runs += 1;
  });
  await scheduler.start();
});
afterAll(async () => {
  await scheduler.stop();
  await killSwitch.set(false, "test end");
  // 공유 omnis_test DB: 등록한 test_* 잡을 지우지 않으면 0006의 seed 개수 단언이 깨진다.
  await query(pool, `DELETE FROM jobs WHERE name = 'test_killable'`);
  await events.close();
  await pool.end();
});

describe("kill switch stops the scheduler", () => {
  it("runs a due job while the switch is off", async () => {
    runs = 0;
    await makeDue();
    await new Promise((r) => setTimeout(r, 400));
    expect(runs).toBe(1);
  });

  it("stops running due jobs while the switch is on, and leaves the claim untouched", async () => {
    // set()은 audit insert가 끝난 뒤에야 cached=on을 넣는다. 그 사이에 게이트를 통과한 틱이
    // 아직 날고 있으므로, 먼저 가라앉히고 그 다음에 카운터를 0으로 만든다(순서가 핵심).
    await killSwitch.set(true, "stop everything");
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    runs = 0;
    await makeDue();
    await new Promise((r) => setTimeout(r, 400));
    expect(runs).toBe(0);

    const row = await one<{ claimed_at: Date | null }>(
      pool,
      `SELECT claimed_at FROM jobs WHERE name = 'test_killable'`,
    );
    expect(row.claimed_at).toBeNull();
  });

  it("resumes on the next tick once the switch goes off", async () => {
    runs = 0;
    await killSwitch.set(false, "resume");
    await makeDue();
    await new Promise((r) => setTimeout(r, 400));
    expect(runs).toBe(1);
  });
});
