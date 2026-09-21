import { createPool, one, query } from "@omnis/db";
import { ApprovalStateError, type Approvals, createApprovals, createLogger } from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let approvals: Approvals;

beforeAll(() => {
  pool = createPool();
  approvals = createApprovals({ pool, logger: createLogger("@omnis/kernel") });
});
afterAll(async () => {
  await pool.end();
});

const base = {
  args: { text: "draft" },
  description: "decide test",
  config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
  risk: "normal" as const,
};

/* loop-r2-02: the draft the approval is about. One thread, created once and reused; a fresh item per
   test, because each decision is supposed to leave its own item in a different place. */
let draftAccountId = "";
let draftThreadId = "";
beforeAll(async () => {
  const account = await one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','decide@test','decide')
       ON CONFLICT (channel, external_id) DO UPDATE SET display = 'decide' RETURNING id`,
  );
  draftAccountId = account.id;
  const thread = await one<{ id: string }>(
    pool,
    `INSERT INTO threads (account_id, external_id, kind, meta)
       VALUES ($1, 'thr_decide', 'group', '{}'::jsonb)
       ON CONFLICT (account_id, external_id) DO UPDATE SET meta = '{}'::jsonb RETURNING id`,
    [draftAccountId],
  );
  draftThreadId = thread.id;
});

/** A draft item with no `external_id` — it has not reached the channel, which is what `draft` means. */
async function makeDraft(): Promise<string> {
  const item = await one<{ id: string }>(
    pool,
    `INSERT INTO items (thread_id, account_id, kind, status, scope, body, sent_at)
       VALUES ($1, $2, 'message', 'draft', 'work', 'yes, I will review it today', now())
       RETURNING id`,
    [draftThreadId, draftAccountId],
  );
  return item.id;
}

async function statusOf(itemId: string): Promise<string | undefined> {
  const row = await one<{ status: string }>(pool, "SELECT status FROM items WHERE id = $1", [
    itemId,
  ]);
  return row.status;
}

describe("approvals.decide", () => {
  it("moves pending → decided and stores decision + decided_args + decided_at", async () => {
    const id = await approvals.propose({ ...base, action: "send" });
    await approvals.decide(id, { decision: "edit", decided_args: { text: "edited draft" } });

    const row = await one<{
      state: string;
      decision: string;
      decided_args: Record<string, unknown>;
      decided_at: Date;
    }>(
      pool,
      "SELECT state, decision, decided_args, decided_at FROM pending_approvals WHERE id = $1",
      [id],
    );
    expect(row.state).toBe("decided");
    expect(row.decision).toBe("edit");
    expect(row.decided_args.text).toBe("edited draft");
    expect(row.decided_at).toBeInstanceOf(Date);
  });

  it("accepts a decision with no decided_args", async () => {
    const id = await approvals.propose({ ...base, action: "delete" });
    await approvals.decide(id, { decision: "ignore" });
    const row = await one<{ decision: string; decided_args: unknown }>(
      pool,
      "SELECT decision, decided_args FROM pending_approvals WHERE id = $1",
      [id],
    );
    expect(row.decision).toBe("ignore");
    expect(row.decided_args).toBeNull();
  });

  it("refuses a second decide on the same approval", async () => {
    const id = await approvals.propose({ ...base, action: "send" });
    await approvals.decide(id, { decision: "accept" });
    await expect(approvals.decide(id, { decision: "ignore" })).rejects.toThrow(ApprovalStateError);
    await expect(approvals.decide(id, { decision: "ignore" })).rejects.toThrow(/not pending/);
  });

  it("refuses a decision the config disallows", async () => {
    const id = await approvals.propose({
      ...base,
      action: "delegate",
      config: { allow_accept: true, allow_edit: false, allow_respond: false, allow_ignore: true },
    });
    await expect(approvals.decide(id, { decision: "edit", decided_args: {} })).rejects.toThrow(
      /config forbids decision "edit"/,
    );
    const row = await one<{ state: string }>(
      pool,
      "SELECT state FROM pending_approvals WHERE id = $1",
      [id],
    );
    expect(row.state).toBe("pending");
  });

  it("refuses a decision on an expired approval", async () => {
    const id = await approvals.propose({
      ...base,
      action: "send",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await expect(approvals.decide(id, { decision: "accept" })).rejects.toThrow(/expired/);
  });

  it("refuses an unknown id and an invalid decision value", async () => {
    await expect(
      approvals.decide("11111111-1111-1111-1111-111111111111", { decision: "accept" }),
    ).rejects.toThrow(/not found/);
    const id = await approvals.propose({ ...base, action: "send" });
    await expect(approvals.decide(id, { decision: "maybe" })).rejects.toThrow();
    await query(pool, "SELECT 1");
  });
});

/* loop-r2-02: a decision on the approval *is* the decision on the draft. Before this, deciding the
   approval left the item a draft, so the same reply stayed on screen as a second, separately
   decidable object — the "one reply, three surfaces" report. */
describe("approvals.decide — the draft it was proposed with", () => {
  it("archives the draft when the decision is ignore", async () => {
    const itemId = await makeDraft();
    const id = await approvals.propose({
      ...base,
      action: "send",
      thread_id: draftThreadId,
      item_id: itemId,
    });
    await approvals.decide(id, { decision: "ignore" });
    expect(await statusOf(itemId)).toBe("archived");
  });

  it("approves the draft when the decision is accept", async () => {
    const itemId = await makeDraft();
    const id = await approvals.propose({
      ...base,
      action: "send",
      thread_id: draftThreadId,
      item_id: itemId,
    });
    await approvals.decide(id, { decision: "accept" });
    expect(await statusOf(itemId)).toBe("approved");
  });

  it("leaves the draft a draft when the decision is respond", async () => {
    // A response goes back to the agent; it decides nothing about the draft, so the person still
    // has it to approve or discard afterwards.
    const itemId = await makeDraft();
    const id = await approvals.propose({
      ...base,
      action: "send",
      config: { allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: true },
      thread_id: draftThreadId,
      item_id: itemId,
    });
    await approvals.decide(id, { decision: "respond", decided_args: { response: "use Tuesday" } });
    expect(await statusOf(itemId)).toBe("draft");
  });

  it("touches no item when the approval carries no item_id", async () => {
    const itemId = await makeDraft();
    const id = await approvals.propose({ ...base, action: "send" });
    await approvals.decide(id, { decision: "ignore" });
    expect(await statusOf(itemId)).toBe("draft");
  });

  it("leaves an item that is no longer a draft alone", async () => {
    // The `status = 'draft'` guard in the UPDATE: an approval raised over a message that has since
    // been sent must not archive it.
    const itemId = await makeDraft();
    await query(pool, "UPDATE items SET status = 'sent' WHERE id = $1", [itemId]);
    const id = await approvals.propose({
      ...base,
      action: "send",
      thread_id: draftThreadId,
      item_id: itemId,
    });
    await approvals.decide(id, { decision: "ignore" });
    expect(await statusOf(itemId)).toBe("sent");
  });
});
