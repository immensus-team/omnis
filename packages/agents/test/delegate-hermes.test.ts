// US-C07 / C-D6 (A4 §5.2): hermes joins the routing table in code but stays off in production.
// `pickRuntime` returns it only for a non-code task whose host is online *and* whose skills match,
// and a `hermes` proposal becomes an approval card only while `delegation.hermes_enabled` is true —
// with the flag off the task is still stored (kind='delegation'), just with nothing to approve.
// The flag is read straight from the settings kv table: @omnis/agents cannot import @omnis/kernel
// (biome contract §1), the same way src/decision/router.ts reads `agents.decision_provider`.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DelegateOutput,
  PROPOSE_TOOLS,
  ProposeDelegationInput,
  configureAgents,
  pickRuntime,
  toolRegistry,
} from "../src/index.js";
import { returningId } from "./integration/returning-id.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});

const HERMES_ENABLED_KEY = "delegation.hermes_enabled";

/** Mirrors the hub's own read (`hermesEnabled === true`) so a non-boolean row counts as false. */
async function setHermesEnabled(value: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, to_jsonb($2::boolean), now())
     ON CONFLICT (key) DO UPDATE SET value = to_jsonb($2::boolean), updated_at = now()`,
    [HERMES_ENABLED_KEY, value],
  );
}

const callOpts = { toolCallId: "c-hermes", messages: [], context: undefined };

/** The two hermes signals are opt-in; both must hold for the hermes row to win. */
const HERMES_ON = { hermesOnline: true, hermesSkillMatch: true } as const;

describe("pickRuntime (A4 §5.2, C-D6)", () => {
  it("picks hermes for a non-code task when the host is online and the skill matches", () => {
    expect(
      pickRuntime({
        filesTouched: 2,
        specClear: true,
        liveCodexSession: false,
        isCode: false,
        ...HERMES_ON,
      }),
    ).toBe("hermes");
  });

  it("falls back to omnis when the hermes host is offline or the skill does not match", () => {
    const task = { filesTouched: 2, specClear: true, liveCodexSession: false, isCode: false };
    expect(pickRuntime({ ...task, hermesOnline: false, hermesSkillMatch: true })).toBe("omnis");
    expect(pickRuntime({ ...task, hermesOnline: true, hermesSkillMatch: false })).toBe("omnis");
  });

  it("never picks hermes for a code task, whatever the hermes signals say", () => {
    expect(
      pickRuntime({
        filesTouched: 5,
        specClear: false,
        liveCodexSession: false,
        isCode: true,
        ...HERMES_ON,
      }),
    ).toBe("claude_code");
    expect(
      pickRuntime({
        filesTouched: 1,
        specClear: true,
        liveCodexSession: true,
        isCode: true,
        ...HERMES_ON,
      }),
    ).toBe("codex");
    expect(
      pickRuntime({
        filesTouched: 1,
        specClear: true,
        liveCodexSession: false,
        isCode: true,
        ...HERMES_ON,
      }),
    ).toBe("claude_ds");
  });
});

describe("hermes in the delegation schemas (C-D6)", () => {
  it("accepts hermes in both the loop output and the tool input, and nothing else new", () => {
    expect(DelegateOutput.shape.runtime.safeParse("hermes").success).toBe(true);
    expect(ProposeDelegationInput.shape.runtime.safeParse("hermes").success).toBe(true);
    expect(ProposeDelegationInput.shape.runtime.safeParse("hal9000").success).toBe(false);
  });
});

describe("propose_delegation with runtime 'hermes' (C-D6)", () => {
  let sourceItemId = "";

  beforeAll(async () => {
    configureAgents({ pool });
    const accountId = returningId(
      await pool.query<{ id: string }>(
        `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','hermes@test','h')
           ON CONFLICT (channel, external_id) DO UPDATE SET display='h' RETURNING id`,
      ),
    );
    const threadId = returningId(
      await pool.query<{ id: string }>(
        `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_hermes','email')
           ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
        [accountId],
      ),
    );
    sourceItemId = returningId(
      await pool.query<{ id: string }>(
        `INSERT INTO items (thread_id, account_id, external_id, kind, subject, body, sent_at)
         VALUES ($1,$2,'it_hermes','email','Report','Summarize this', now())
         ON CONFLICT (account_id, external_id) WHERE external_id IS NOT NULL
           DO UPDATE SET body = EXCLUDED.body RETURNING id`,
        [threadId, accountId],
      ),
    );
  });

  afterAll(async () => {
    await setHermesEnabled(false);
    await pool.end();
  });

  /** propose_task first: propose_delegation is only ever called on a task the loop already stored. */
  async function agentTask(title: string): Promise<string> {
    const set = toolRegistry(["propose_task"]);
    const out = (await set.propose_task?.execute?.(
      {
        title,
        source_item_id: sourceItemId,
        due_basis: "none",
        owner: "agent",
        kind: "todo",
        confidence: 0.8,
      },
      callOpts,
    )) as { task_id: string };
    return out.task_id;
  }

  async function proposeHermes(
    taskId: string,
  ): Promise<{ approval_id: string | null; state: string }> {
    return (await PROPOSE_TOOLS.propose_delegation?.execute?.(
      {
        task_id: taskId,
        runtime: "hermes",
        host: "mini",
        brief: "Summarize the report",
        acceptance: ["the summary is stored"],
        est_minutes: 15,
        confidence: 0.7,
      },
      callOpts,
    )) as { approval_id: string | null; state: string };
  }

  it("stores the task and creates no approval while delegation.hermes_enabled is false", async () => {
    await setHermesEnabled(false);
    const taskId = await agentTask("Hermes with the flag off");

    const out = await proposeHermes(taskId);
    expect(out.state).toBe("disabled");
    expect(out.approval_id).toBeNull();

    const tasks = await pool.query<{ n: string; kind: string }>(
      "SELECT count(*)::text AS n, min(kind) AS kind FROM tasks WHERE id = $1",
      [taskId],
    );
    expect(tasks.rows[0]).toMatchObject({ n: "1", kind: "delegation" });

    const approvals = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pending_approvals WHERE task_id = $1",
      [taskId],
    );
    expect(approvals.rows[0]?.n).toBe("0");
  });

  it("creates a pending approval once delegation.hermes_enabled is true", async () => {
    await setHermesEnabled(true);
    const taskId = await agentTask("Hermes with the flag on");

    const out = await proposeHermes(taskId);
    expect(out.state).toBe("pending");
    expect(out.approval_id).not.toBeNull();

    const approvals = await pool.query<{ n: string; action: string; state: string; args: unknown }>(
      `SELECT count(*) OVER ()::text AS n, action, state, args
         FROM pending_approvals WHERE task_id = $1`,
      [taskId],
    );
    expect(approvals.rows).toHaveLength(1);
    expect(approvals.rows[0]).toMatchObject({ n: "1", action: "delegate", state: "pending" });
    expect((approvals.rows[0]?.args as { runtime: string }).runtime).toBe("hermes");
  });
});
