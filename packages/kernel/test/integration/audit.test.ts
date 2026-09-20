import { createPool, one, query } from "@omnis/db";
import { type Audit, countUnapprovedSends, createAudit } from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let audit: Audit;

beforeAll(() => {
  pool = createPool();
  audit = createAudit(pool);
});
afterAll(async () => {
  await pool.end();
});

describe("audit.record", () => {
  it("writes every field and leaves optionals null", async () => {
    await audit.record({
      actor: "agent:codex",
      action: "item.sent",
      target_table: "items",
      target_id: "22222222-2222-2222-2222-222222222222",
      before: { status: "approved" },
      after: { status: "sent", external_id: "1758.000200" },
      approval_id: "33333333-3333-3333-3333-333333333333",
    });
    const row = await one<{
      actor: string;
      action: string;
      target_table: string;
      target_id: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      approval_id: string;
      at: Date;
    }>(pool, `SELECT * FROM audit_log WHERE action = 'item.sent' ORDER BY seq DESC LIMIT 1`);

    expect(row.actor).toBe("agent:codex");
    expect(row.target_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(row.before.status).toBe("approved");
    expect(row.after.external_id).toBe("1758.000200");
    expect(row.approval_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(row.at).toBeInstanceOf(Date);
  });

  it("accepts an entry with no optional fields", async () => {
    await audit.record({ actor: "system", action: "hub.started", target_table: "jobs" });
    const row = await one<{
      target_id: string | null;
      before: unknown;
      after: unknown;
      approval_id: string | null;
    }>(
      pool,
      `SELECT target_id, before, after, approval_id FROM audit_log WHERE action='hub.started' ORDER BY seq DESC LIMIT 1`,
    );
    expect(row.target_id).toBeNull();
    expect(row.before).toBeNull();
    expect(row.after).toBeNull();
    expect(row.approval_id).toBeNull();
  });

  it("keeps a target_id that no longer exists (no FK, A3 §1)", async () => {
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T-au:U','au') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'au-1','dm') RETURNING id`,
      [acc.id],
    );
    await audit.record({
      actor: "me",
      action: "thread.archived",
      target_table: "threads",
      target_id: thr.id,
    });
    await query(pool, "DELETE FROM threads WHERE id = $1", [thr.id]);

    const row = await one<{ target_id: string }>(
      pool,
      `SELECT target_id FROM audit_log WHERE action='thread.archived' ORDER BY seq DESC LIMIT 1`,
    );
    expect(row.target_id).toBe(thr.id);
  });

  it("cannot be edited or deleted", async () => {
    const row = await one<{ seq: string }>(
      pool,
      "SELECT seq::text AS seq FROM audit_log ORDER BY seq DESC LIMIT 1",
    );
    await expect(
      query(pool, `UPDATE audit_log SET actor='hacker' WHERE seq=$1`, [row.seq]),
    ).rejects.toThrow(/append-only/);
    await expect(query(pool, "DELETE FROM audit_log WHERE seq=$1", [row.seq])).rejects.toThrow(
      /append-only/,
    );
  });
});

describe("countUnapprovedSends (A3 §9 rule 5 / master §2)", () => {
  it("counts item.sent rows that carry no approval_id", async () => {
    const since = new Date(Date.now() - 60_000);
    const before = await countUnapprovedSends(pool, since);

    await audit.record({
      actor: "agent:claude_code",
      action: "item.sent",
      target_table: "items",
      target_id: "44444444-4444-4444-4444-444444444444",
    });
    expect(await countUnapprovedSends(pool, since)).toBe(before + 1);

    await audit.record({
      actor: "me",
      action: "item.sent",
      target_table: "items",
      target_id: "55555555-5555-5555-5555-555555555555",
      approval_id: "66666666-6666-6666-6666-666666666666",
    });
    expect(await countUnapprovedSends(pool, since)).toBe(before + 1);
  });
});
