import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_REMIND_CRON, remindGroups, runTaskRemind } from "../../src/jobs/task-remind.js";
import { createLogger } from "../../src/logger.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
afterAll(() => pool.end());
// This job counts every task — rows left behind by other files would hide the "all empty" case.
beforeEach(() => pool.query("DELETE FROM tasks"));

describe("task_remind (A4 §4.3)", () => {
  it("runs at 09/14/19 KST under the seeded job name", async () => {
    expect(TASK_REMIND_CRON).toBe("0 9,14,19 * * *");
    const { rows } = await pool.query<{ schedule: string }>(
      "SELECT schedule FROM jobs WHERE name = 'task_remind'",
    );
    expect(rows[0]?.schedule).toBe("0 9,14,19 * * *");
  });

  it("splits open tasks into due_soon / stale / undelegated", async () => {
    await pool.query(
      `INSERT INTO tasks (title, state, due_at, created_at, created_by) VALUES
         ('due today','open', now() + interval '3 hours', now(), 'remind-test'),
         ('untouched for 3 days','open', NULL, now() - interval '4 days', 'remind-test')`,
    );
    await pool.query(
      `INSERT INTO tasks (title, state, owner_kind, delegated_session_id, created_at, created_by)
       VALUES ('delegation not yet sent','open','agent', NULL, now() - interval '5 hours', 'remind-test')`,
    );
    const groups = await remindGroups(pool);
    const by = Object.fromEntries(groups.map((g) => [g.kind, g]));
    expect(by.due_soon?.count).toBe(1);
    expect(by.stale?.count).toBe(1);
    expect(by.undelegated?.count).toBe(1);
    expect(by.due_soon?.line).toContain("due today");
    expect(by.stale?.line).toContain("3 days");
    expect(by.undelegated?.line).toContain("agent");
    expect(by.due_soon?.task_ids).toHaveLength(1);
  });

  it("leaves done, not-yet-due and still-fresh tasks out of every group", async () => {
    await pool.query(
      `INSERT INTO tasks (title, state, owner_kind, due_at, created_at, created_by) VALUES
         ('already done','done','me', now() + interval '1 hour', now(), 'remind-test'),
         ('not due yet','open','me', now() + interval '3 days', now(), 'remind-test'),
         ('two days old','open','me', NULL, now() - interval '2 days', 'remind-test'),
         ('just created delegation','open','agent', NULL, now() - interval '1 hour', 'remind-test')`,
    );
    expect(await remindGroups(pool)).toHaveLength(0);
  });

  it("sends one batched push per non-empty group and nothing when all empty", async () => {
    const send = vi.fn(async () => undefined);
    const logger = createLogger("@omnis/kernel");
    const sentEmpty = await runTaskRemind({ pool, logger, notifier: { send } });
    expect(sentEmpty).toBe(0);
    expect(send).not.toHaveBeenCalled();

    await pool.query(
      `INSERT INTO tasks (title, state, due_at, created_by)
       VALUES ('due today','open', now() + interval '2 hours', 'remind-test')`,
    );
    await runTaskRemind({ pool, logger, notifier: { send } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toBe("batched");
    expect(send.mock.calls[0]?.[0]?.deep_link).toBe("omnis://tasks");
  });
});
