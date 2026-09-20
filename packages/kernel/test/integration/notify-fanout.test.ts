import { createPool, one, query } from "@omnis/db";
import { type Events, createEvents, createLogger } from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let events: Events & { close(): Promise<void> };
const received: Array<{ channel: string; payload: Record<string, unknown> }> = [];

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
  for (const ch of ["omnis_item", "omnis_thread", "omnis_approval"]) {
    events.subscribe(ch, (p) => received.push({ channel: ch, payload: p }));
  }
  // Wait one beat for LISTEN to take effect (subscribe grabs its connection asynchronously).
  await new Promise((r) => setTimeout(r, 300));
});
afterAll(async () => {
  await events.close();
  await pool.end();
});

function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (pred()) {
        clearInterval(tick);
        resolve();
      } else if (Date.now() - started > ms) {
        clearInterval(tick);
        reject(new Error("timed out waiting for NOTIFY"));
      }
    }, 25);
  });
}

describe("DB trigger → kernel subscriber", () => {
  it("delivers omnis_thread and omnis_item without anyone calling emit()", async () => {
    received.length = 0;
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T-fan:U','fan') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'fan-1','dm') RETURNING id`,
      [acc.id],
    );
    const item = await one<{ id: string }>(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, body, sent_at)
       VALUES ($1,$2,'message','fanout', now()) RETURNING id`,
      [thr.id, acc.id],
    );

    await waitFor(() => received.some((r) => r.payload.id === item.id));
    const itemMsg = received.find((r) => r.channel === "omnis_item");
    expect(itemMsg?.payload).toEqual({ id: item.id, thread_id: thr.id, op: "insert" });
    expect(received.some((r) => r.channel === "omnis_thread" && r.payload.id === thr.id)).toBe(
      true,
    );
  });

  it("coalesces identical payloads inside one transaction (A3 §6.2)", async () => {
    received.length = 0;
    const thr = await one<{ id: string }>(pool, `SELECT id FROM threads WHERE external_id='fan-1'`);
    await query(
      pool,
      `DO $$
       DECLARE t uuid := (SELECT id FROM threads WHERE external_id = 'fan-1');
       BEGIN
         UPDATE threads SET unread_count = unread_count + 1 WHERE id = t;
         UPDATE threads SET unread_count = unread_count + 1 WHERE id = t;
       END $$;`,
    );
    await waitFor(() => received.some((r) => r.channel === "omnis_thread"));
    await new Promise((r) => setTimeout(r, 200));
    const threadMsgs = received.filter(
      (r) => r.channel === "omnis_thread" && r.payload.id === thr.id,
    );
    expect(threadMsgs).toHaveLength(1);
  });

  it("delivers omnis_approval on insert and on decide, but not on executing", async () => {
    received.length = 0;
    const a = await one<{ id: string }>(
      pool,
      `INSERT INTO pending_approvals (action, args, description)
       VALUES ('delegate','{}'::jsonb,'fanout') RETURNING id`,
    );
    await waitFor(() => received.some((r) => r.channel === "omnis_approval"));
    expect(received.at(-1)?.payload).toEqual({ id: a.id, state: "pending" });

    received.length = 0;
    await query(
      pool,
      `UPDATE pending_approvals SET state='decided', decision='ignore', decided_at=now() WHERE id=$1`,
      [a.id],
    );
    await waitFor(() => received.length > 0);
    expect(received.at(-1)?.payload).toEqual({ id: a.id, state: "decided" });

    received.length = 0;
    await query(pool, `UPDATE pending_approvals SET state='executing' WHERE id=$1`, [a.id]);
    await new Promise((r) => setTimeout(r, 250));
    expect(received).toHaveLength(0);
  });
});
