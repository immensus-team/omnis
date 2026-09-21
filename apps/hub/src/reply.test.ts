// loop-r2-03: the composer's one write. A reply is never sent directly — this route proposes the
// `send` approval that the thread's inline card then carries — so the thing worth proving is the
// row that lands in `pending_approvals`, not the SQL string: the action, the channel and the body
// have to be the ones the person typed, and the approval has to be on the thread they typed it into.
//
// The unit-test database is migrated and not seeded (the seed is tools/e2e's), so this file owns its
// fixtures: one Slack account and one thread, both taken back out in afterAll. Boots the real hub
// server over a real pool the way apps/hub/test/integration/routes.test.ts and tasks.test.ts do —
// a fake pool would prove the route is wired to *a* query, not that the row lands in the table.
import type { AddressInfo } from "node:net";
import { createPool, query } from "@omnis/db";
import { createKernel, createLogger } from "@omnis/kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HUB_VERSION, type HubConfig } from "./config.js";
import { createHubServer } from "./http.js";
import { REPLY_ERROR, REPLY_MAX_CHARS, proposeReply } from "./reply.js";

function testConfig(): HubConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    version: HUB_VERSION,
    bridgeToken: "",
    userId: "logan",
    zeroAuthSecret: "",
    googleOAuthClientId: "",
    googleOAuthClientSecret: "",
    outlookClientId: "",
    ntfyUrl: "http://127.0.0.1:2586",
    webpushVapidPublic: "",
    webpushVapidPrivate: "",
    webpushSubject: "mailto:test@example.com",
  };
}

const ACCOUNT_EXTERNAL_ID = "e2e-reply-03";
const THREAD_EXTERNAL_ID = "e2e-reply-03-thread";
/** The thread title the description quotes; a Slack title is the channel's own name. */
const TITLE = "#omnis-launch";
const BODY = "I'll send comments Wednesday.";

let base = "";
let pool: ReturnType<typeof createPool>;
let close: () => Promise<void>;
let threadId = "";
let approvals: { propose(i: unknown): Promise<string> };

function post(id: string, body: string): Promise<Response> {
  return fetch(`${base}/threads/${id}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

/** Every approval this file raised, so afterAll can take its own rows back out. */
async function clearApprovals(): Promise<void> {
  await query(
    pool,
    "DELETE FROM pending_approvals WHERE thread_id IN (SELECT id FROM threads WHERE account_id IN (SELECT id FROM accounts WHERE channel = 'slack' AND external_id = $1))",
    [ACCOUNT_EXTERNAL_ID],
  );
}

beforeAll(async () => {
  pool = createPool();
  const kernel = createKernel({ pool });
  approvals = kernel.approvals;
  await clearApprovals();
  // The account is reused across runs of this file, so it is upserted; the thread is deleted and
  // re-created, because its id is what the approvals below hang off.
  await query(
    pool,
    `INSERT INTO accounts (channel, external_id, display, capabilities)
       VALUES ('slack', $1, 'e2e slack reply', '{"read":true,"write":true}'::jsonb)
     ON CONFLICT (channel, external_id) DO NOTHING`,
    [ACCOUNT_EXTERNAL_ID],
  );
  const account = await query<{ id: string }>(
    pool,
    "SELECT id FROM accounts WHERE channel = 'slack' AND external_id = $1",
    [ACCOUNT_EXTERNAL_ID],
  );
  const accountId = account[0]?.id;
  if (accountId === undefined) throw new Error("the reply test's account was not created");
  await query(pool, "DELETE FROM threads WHERE account_id = $1", [accountId]);
  const thread = await query<{ id: string }>(
    pool,
    `INSERT INTO threads (account_id, external_id, kind, title, scope)
       VALUES ($1, $2, 'group', $3, 'work') RETURNING id`,
    [accountId, THREAD_EXTERNAL_ID, TITLE],
  );
  threadId = thread[0]?.id ?? "";
  if (threadId === "") throw new Error("the reply test's thread was not created");

  const server = createHubServer({
    kernel,
    pool,
    config: testConfig(),
    logger: createLogger("@omnis/hub"),
    startedAt: Date.now(),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await kernel.close();
    await pool.end();
  };
});

afterAll(async () => {
  await clearApprovals();
  await query(pool, "DELETE FROM threads WHERE external_id = $1", [THREAD_EXTERNAL_ID]);
  await query(pool, "DELETE FROM accounts WHERE channel = 'slack' AND external_id = $1", [
    ACCOUNT_EXTERNAL_ID,
  ]);
  await close();
});

interface StoredApproval {
  action: string;
  args: { body?: string; channel?: string; thread_external_id?: string };
  description: string;
  state: string;
  thread_id: string | null;
  item_id: string | null;
}

async function stored(id: string): Promise<StoredApproval> {
  const rows = await query<StoredApproval>(
    pool,
    "SELECT action, args, description, state, thread_id, item_id FROM pending_approvals WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`no pending_approvals row ${id}`);
  return row;
}

describe("proposeReply (loop-r2-03)", () => {
  it("proposes one `send` on the thread, carrying the body and the channel", async () => {
    const outcome = await proposeReply({ pool, approvals }, threadId, BODY);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(await stored(outcome.approval_id)).toEqual({
      action: "send",
      // The channel is read off the account, not passed in by the caller: the composer knows the
      // thread, and the hub is the one that knows which account a reply in it would leave on.
      args: { channel: "slack", body: BODY, thread_external_id: THREAD_EXTERNAL_ID },
      description: `Reply in ${TITLE}`,
      state: "pending",
      thread_id: threadId,
      // No item: a reply is a message that does not exist yet, which is exactly why loop-r2-02's
      // foldDraft finds nothing to pair it with and the card stands on its own.
      item_id: null,
    });
  });

  it("trims the body before it is proposed", async () => {
    const outcome = await proposeReply({ pool, approvals }, threadId, `  ${BODY}\n`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect((await stored(outcome.approval_id)).args.body).toBe(BODY);
  });

  it("rejects a body that is empty once trimmed", async () => {
    for (const body of ["", "   ", "\n\t"]) {
      expect(await proposeReply({ pool, approvals }, threadId, body)).toEqual({
        ok: false,
        reason: "bad_request",
      });
    }
  });

  it("rejects a body past the cap", async () => {
    const over = "x".repeat(REPLY_MAX_CHARS + 1);
    expect(await proposeReply({ pool, approvals }, threadId, over)).toEqual({
      ok: false,
      reason: "bad_request",
    });
    // The boundary itself is accepted, so the cap is the number the error message names.
    const at = "x".repeat(REPLY_MAX_CHARS);
    expect((await proposeReply({ pool, approvals }, threadId, at)).ok).toBe(true);
  });

  it("answers not-found for a thread that does not exist", async () => {
    expect(
      await proposeReply({ pool, approvals }, "11111111-1111-1111-1111-111111111111", BODY),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("POST /threads/:id/reply", () => {
  it("answers 201 with the new approval's id, and stores it", async () => {
    const res = await post(threadId, JSON.stringify({ body: BODY }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { approval_id: string };
    expect(typeof body.approval_id).toBe("string");
    expect((await stored(body.approval_id)).args.body).toBe(BODY);
  });

  it("refuses an empty body, naming the rule it broke", async () => {
    const res = await post(threadId, JSON.stringify({ body: "  " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: REPLY_ERROR });
  });

  it("refuses a body whose `body` is not a string", async () => {
    for (const json of [JSON.stringify({}), JSON.stringify({ body: 42 }), "null"]) {
      const res = await post(threadId, json);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: REPLY_ERROR });
    }
  });

  it("answers 400 for a body that is not json", async () => {
    const res = await post(threadId, "{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json body" });
  });

  it("answers 404 for a thread that does not exist", async () => {
    const res = await post("11111111-1111-1111-1111-111111111111", JSON.stringify({ body: BODY }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "thread not found" });
  });

  it("answers 405 for anything but POST", async () => {
    const res = await fetch(`${base}/threads/${threadId}/reply`);
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "method not allowed" });
  });

  it("reaches the same handler with the /api prefix the desktop uses", async () => {
    // Tailscale Serve strips the prefix on the mini and the desktop calls 127.0.0.1 directly with
    // it; both spellings have to arrive at the route above.
    const res = await fetch(`${base}/api/threads/${threadId}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: BODY }),
    });
    expect(res.status).toBe(201);
  });
});
