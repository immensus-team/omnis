import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PHANTOM_TOOLS, TOOL_NAMES, configureAgents, toolRegistry } from "../../src/index.js";
import { returningId } from "./returning-id.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let threadId = "";
let itemId = "";

beforeAll(async () => {
  configureAgents({ pool });
  const accountId = returningId(
    await pool.query<{ id: string }>(
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','tools@test','t')
         ON CONFLICT (channel, external_id) DO UPDATE SET display='t' RETURNING id`,
    ),
  );
  threadId = returningId(
    await pool.query<{ id: string }>(
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_tools','email')
         ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
      [accountId],
    ),
  );
  itemId = returningId(
    await pool.query<{ id: string }>(
      `INSERT INTO items (thread_id, account_id, external_id, kind, subject, body, sent_at)
       VALUES ($1,$2,'it_tools','email','Quote','I will send it by tomorrow', now())
       ON CONFLICT (account_id, external_id) WHERE external_id IS NOT NULL
         DO UPDATE SET body = EXCLUDED.body RETURNING id`,
      [threadId, accountId],
    ),
  );
});
afterAll(() => pool.end());

const callOpts = { toolCallId: "c1", messages: [], context: undefined };

describe("tool palette (A4 §1.5)", () => {
  it("exposes only the requested tools", () => {
    const set = toolRegistry(["read_thread", "propose_task"]);
    expect(Object.keys(set).sort()).toEqual(["propose_task", "read_thread"]);
  });

  it("never exposes a phantom tool, whatever the palette asks for", () => {
    const all = toolRegistry(TOOL_NAMES);
    for (const p of PHANTOM_TOOLS) expect(Object.keys(all)).not.toContain(p);
    expect(Object.keys(all)).toHaveLength(13);
  });

  it("read_thread returns the thread and its items", async () => {
    const set = toolRegistry(["read_thread"]);
    const out = (await set.read_thread?.execute?.(
      { thread_id: threadId, last_n: 5 },
      callOpts,
    )) as { items: { item_id: string }[] };
    expect(out.items.map((i) => i.item_id)).toContain(itemId);
  });

  it("propose_task stores an open task and returns its id", async () => {
    const set = toolRegistry(["propose_task"]);
    const out = (await set.propose_task?.execute?.(
      {
        title: "Send the quote",
        source_item_id: itemId,
        due_basis: "stated",
        owner: "me",
        kind: "todo",
        confidence: 0.9,
      },
      callOpts,
    )) as { task_id: string; state: string };
    expect(out.state).toBe("open");
    const { rows } = await pool.query<{ title: string; created_by: string }>(
      "SELECT title, created_by FROM tasks WHERE id = $1",
      [out.task_id],
    );
    expect(rows[0]).toMatchObject({ title: "Send the quote", created_by: "agent" });
  });

  it("propose_delegation stores a pending delegate approval linked to the thread", async () => {
    const set = toolRegistry(["propose_task", "propose_delegation"]);
    const task = (await set.propose_task?.execute?.(
      {
        title: "Delegate the refactor",
        source_item_id: itemId,
        due_basis: "none",
        owner: "agent",
        kind: "todo",
        confidence: 0.8,
      },
      callOpts,
    )) as { task_id: string };
    const out = (await set.propose_delegation?.execute?.(
      {
        task_id: task.task_id,
        runtime: "claude_code",
        host: "mini",
        brief: "Clean up this module",
        acceptance: ["tests pass"],
        est_minutes: 45,
        confidence: 0.7,
      },
      callOpts,
    )) as { approval_id: string; state: string };
    expect(out.state).toBe("pending");
    const { rows } = await pool.query<{
      action: string;
      state: string;
      risk: string;
      thread_id: string | null;
    }>("SELECT action, state, risk, thread_id FROM pending_approvals WHERE id = $1", [
      out.approval_id,
    ]);
    expect(rows[0]).toMatchObject({
      action: "delegate",
      state: "pending",
      risk: "high",
      thread_id: threadId,
    });
    const { rows: t } = await pool.query<{ kind: string }>("SELECT kind FROM tasks WHERE id = $1", [
      task.task_id,
    ]);
    expect(t[0]?.kind).toBe("delegation");
  });
});
