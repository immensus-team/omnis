import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  TASK_CONFIDENCE_MIN,
  TASK_MAX_PER_ITEM,
  configureAgents,
  taskLoop,
} from "../../src/index.js";
import { returningId } from "./returning-id.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let threadId = "";
let itemId = "";

beforeEach(async () => {
  configureAgents({ pool });
  const accountId = returningId(
    await pool.query<{ id: string }>(
      `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','tl@test','t')
         ON CONFLICT (channel, external_id) DO UPDATE SET display='t' RETURNING id`,
    ),
  );
  threadId = returningId(
    await pool.query<{ id: string }>(
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_tl','dm')
         ON CONFLICT (account_id, external_id) DO UPDATE SET kind='dm' RETURNING id`,
      [accountId],
    ),
  );
  itemId = returningId(
    await pool.query<{ id: string }>(
      `INSERT INTO items (thread_id, account_id, kind, body, sent_at)
       VALUES ($1,$2,'message','I will send the quote by tomorrow', now()) RETURNING id`,
      [threadId, accountId],
    ),
  );
  await pool.query("DELETE FROM pending_approvals WHERE action = 'delegate'");
  await pool.query("DELETE FROM tasks WHERE source_item_id = $1", [itemId]);
});
afterAll(() => pool.end());

const result = (tasks: unknown[], injection_flags: string[] = []) => ({
  loop: "task" as const,
  run_id: "00000000-0000-0000-0000-0000000000bb",
  output: { tasks, confidence: 0.9, rationale: "promise sentence", injection_flags },
  confidence: 0.9,
  rationale: "promise sentence",
  escalate: false,
  injection_flags,
  unresolved: [],
});

const ctx = () => ({
  trigger_kind: "event" as const,
  item_id: itemId,
  thread_id: threadId,
  now: new Date(),
  payload: {},
});

describe("taskLoop (A4 §4.2)", () => {
  it("declares the A4 §4.5 budget and the precision-first thresholds", () => {
    expect(taskLoop.id).toBe("task");
    expect(taskLoop.budget).toEqual({
      inputTokens: 2800,
      outputTokens: 400,
      wallClockMs: 15_000,
      maxSteps: 2,
    });
    expect(TASK_CONFIDENCE_MIN).toBe(0.7);
    expect(TASK_MAX_PER_ITEM).toBe(3);
  });

  it("drops tasks below the confidence floor without storing them", async () => {
    await taskLoop.apply(
      result([
        { title: "Confirmed promise", owner: "me", due_basis: "stated", confidence: 0.8 },
        { title: "Vague guess", owner: "me", due_basis: "inferred", confidence: 0.69 },
      ]) as never,
      ctx(),
    );
    const { rows } = await pool.query<{ title: string }>(
      "SELECT title FROM tasks WHERE source_item_id = $1",
      [itemId],
    );
    expect(rows.map((r) => r.title)).toEqual(["Confirmed promise"]);
  });

  it("stores at most three tasks per item", async () => {
    await taskLoop.apply(
      result(
        [1, 2, 3, 4, 5].map((n) => ({
          title: `Task ${n}`,
          owner: "me",
          due_basis: "none",
          confidence: 0.9,
        })),
      ) as never,
      ctx(),
    );
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM tasks WHERE source_item_id = $1",
      [itemId],
    );
    expect(rows[0]?.n).toBe("3");
  });

  it("merges into the existing task when duplicate_of is set", async () => {
    const existing = returningId(
      await pool.query<{ id: string }>(
        "INSERT INTO tasks (title, created_by) VALUES ('Existing task','agent') RETURNING id",
      ),
    );
    await taskLoop.apply(
      result([
        {
          title: "Same task",
          owner: "me",
          due_basis: "none",
          confidence: 0.9,
          duplicate_of: existing,
        },
      ]) as never,
      ctx(),
    );
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM tasks WHERE source_item_id = $1 AND id <> $2",
      [itemId, existing],
    );
    expect(rows[0]?.n).toBe("0");
    const merged = await pool.query<{ source_item_id: string | null }>(
      "SELECT source_item_id FROM tasks WHERE id = $1",
      [existing],
    );
    expect(merged.rows[0]?.source_item_id).toBe(itemId);
  });

  it("proposes a delegation in the same run when a rule routes an agent-owned task", async () => {
    await taskLoop.apply(
      result([
        {
          // FROZEN fixture — Korean sample the Korean-language GUI_CHANNEL matcher must match.
          title: "카카오톡으로 견적 안내 돌리기",
          owner: "agent",
          due_basis: "none",
          confidence: 0.9,
        },
      ]) as never,
      ctx(),
    );
    const { rows } = await pool.query<{ args: { host: string; rule_id: string } }>(
      "SELECT args FROM pending_approvals WHERE action = 'delegate'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.args.host).toBe("mini");
    expect(rows[0]?.args.rule_id).toBe("dr_gui_session");
  });

  it("never proposes a delegation for an item that carries injection flags", async () => {
    await taskLoop.apply(
      result(
        [
          {
            // FROZEN fixture — same Korean routing sample as above (matches GUI_CHANNEL).
            title: "카카오톡으로 견적 안내 돌리기",
            owner: "agent",
            due_basis: "none",
            confidence: 0.9,
          },
        ],
        ["instruction_override"],
      ) as never,
      ctx(),
    );
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pending_approvals WHERE action = 'delegate'",
    );
    expect(rows[0]?.n).toBe("0");
  });
});
