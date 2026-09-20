import { createPool, one, query } from "@omnis/db";
import { Client } from "pg";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let listener: Client;
const seen: Array<{ channel: string; payload: Record<string, unknown> }> = [];

beforeAll(async () => {
  pool = createPool();
  listener = new Client({ connectionString: process.env.DATABASE_URL });
  await listener.connect();
  listener.on("notification", (msg) => {
    seen.push({
      channel: msg.channel,
      payload: JSON.parse(msg.payload ?? "{}") as Record<string, unknown>,
    });
  });
  for (const ch of [
    "omnis_item",
    "omnis_thread",
    "omnis_approval",
    "omnis_task",
    "omnis_session",
    "omnis_job",
  ]) {
    await listener.query(`LISTEN ${ch}`);
  }
});
afterAll(async () => {
  await listener.end();
  await pool.end();
});

async function settle(): Promise<void> {
  await listener.query("SELECT 1");
  await new Promise((r) => setTimeout(r, 120));
}

describe("0007_notify", () => {
  it("notifies omnis_item with id + thread_id + op and nothing else", async () => {
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T9:U9','n') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'n-1','dm') RETURNING id`,
      [acc.id],
    );
    seen.length = 0;
    const item = await one<{ id: string }>(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, body, sent_at)
       VALUES ($1,$2,'message','hi', now()) RETURNING id`,
      [thr.id, acc.id],
    );
    await settle();

    const itemMsg = seen.find((s) => s.channel === "omnis_item");
    expect(itemMsg?.payload).toEqual({ id: item.id, thread_id: thr.id, op: "insert" });
    expect(seen.some((s) => s.channel === "omnis_thread")).toBe(true);

    seen.length = 0;
    await query(pool, `UPDATE items SET status = 'read' WHERE id = $1`, [item.id]);
    await settle();
    expect(seen.find((s) => s.channel === "omnis_item")?.payload.op).toBe("update");
  });

  it("notifies omnis_approval only for pending and decided", async () => {
    seen.length = 0;
    const a = await one<{ id: string }>(
      pool,
      `INSERT INTO pending_approvals (action, args, description)
       VALUES ('send','{}'::jsonb,'notify') RETURNING id`,
    );
    await settle();
    expect(seen.find((s) => s.channel === "omnis_approval")?.payload).toEqual({
      id: a.id,
      state: "pending",
    });

    seen.length = 0;
    await query(
      pool,
      `UPDATE pending_approvals SET state='decided', decision='accept', decided_at=now() WHERE id=$1`,
      [a.id],
    );
    await settle();
    expect(seen.find((s) => s.channel === "omnis_approval")?.payload).toEqual({
      id: a.id,
      state: "decided",
    });

    seen.length = 0;
    await query(pool, `UPDATE pending_approvals SET state='executing' WHERE id=$1`, [a.id]);
    await settle();
    expect(seen.some((s) => s.channel === "omnis_approval")).toBe(false);
  });

  it("notifies omnis_session with the runtime name and omnis_job with the job name", async () => {
    const runtime = await one<{ id: string }>(
      pool,
      `SELECT id FROM agent_runtimes WHERE runtime='omnis'`,
    );
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('agent','notify','a') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'sess-n','agent_session') RETURNING id`,
      [acc.id],
    );
    seen.length = 0;
    const sess = await one<{ id: string }>(
      pool,
      `INSERT INTO agent_sessions (runtime_id, thread_id, session_key)
       VALUES ($1,$2,'agent:omnis:mini:notify') RETURNING id`,
      [runtime.id, thr.id],
    );
    await settle();
    expect(seen.find((s) => s.channel === "omnis_session")?.payload).toEqual({
      id: sess.id,
      runtime: "omnis",
      state: "starting",
    });

    seen.length = 0;
    const job = await one<{ id: string }>(
      pool,
      `UPDATE jobs SET next_run_at = now() WHERE name = 'slot_health' RETURNING id`,
    );
    await settle();
    expect(seen.find((s) => s.channel === "omnis_job")?.payload).toEqual({
      id: job.id,
      name: "slot_health",
    });
  });

  it("keeps every payload well under the 8,000B NOTIFY limit", async () => {
    for (const s of seen) {
      expect(Buffer.byteLength(JSON.stringify(s.payload), "utf8")).toBeLessThan(8000);
    }
  });
});
