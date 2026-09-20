// US-B45: the registry against the real per-branch DB — accounts + account_secrets rows →
// buildAdapters → createHubServer({adapters}) → the US-A36 archive write-back actually fires.
import type { AddressInfo } from "node:net";
import { createPool, one } from "@omnis/db";
import { type Kernel, createKernel, createLogger, recordAdapterHealth } from "@omnis/kernel";
import type { Adapter, AuthRef, Capabilities, Channel, ThreadRef } from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adaptersByChannel, buildAdapters, loadAccountRows } from "../../src/adapters.js";
import { HUB_VERSION } from "../../src/config.js";
import { createHubServer } from "../../src/http.js";

const logger = createLogger("@omnis/hub", { sink: () => {} });

const caps = (archive: boolean): Capabilities => ({
  read: true,
  write: true,
  realtime: false,
  history: true,
  media: false,
  markRead: true,
  typing: false,
  archive,
  delete: false,
});

const archived: ThreadRef[] = [];
const connects: AuthRef[] = [];

function fakeGmail(): Adapter {
  return {
    id: "fake-gmail",
    channel: "gmail",
    capabilities: () => caps(true),
    async connect(auth: AuthRef) {
      connects.push(auth);
    },
    async archive(thread: ThreadRef) {
      archived.push(thread);
    },
  } as unknown as Adapter;
}

let pool: Pool;
let kernel: Kernel;
let base = "";
let close: () => Promise<void>;

const EXTERNAL_ID = "registry-gmail-account";
const THREAD_EXTERNAL_ID = "G-registry-1";

async function seedAccount(withSecret: boolean): Promise<void> {
  const account = await one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display, capabilities)
       VALUES ('gmail', $1, $1, '{"read":true,"write":true}'::jsonb)
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
     RETURNING id`,
    [EXTERNAL_ID],
  );
  if (withSecret) {
    await pool.query(
      `INSERT INTO account_secrets (account_id, auth_ref, scopes)
         VALUES ($1, $2, ARRAY['gmail.readonly'])
         ON CONFLICT (account_id) DO UPDATE SET auth_ref = EXCLUDED.auth_ref`,
      [account.id, `omnis.gmail.refresh.${EXTERNAL_ID}`],
    );
  }
  await pool.query(
    `INSERT INTO threads (account_id, external_id, kind, title, last_item_at)
       VALUES ($1, $2, 'email', 'registry test', now())
       ON CONFLICT (account_id, external_id) DO UPDATE SET title = EXCLUDED.title`,
    [account.id, THREAD_EXTERNAL_ID],
  );
}

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool, logger });
  await seedAccount(true);

  const bound = await buildAdapters({
    accounts: await loadAccountRows(pool),
    factories: { gmail: fakeGmail },
    logger,
  });
  expect(bound.map((b) => b.channel)).toContain("gmail");

  const server = createHubServer({
    kernel,
    pool,
    config: {
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
    },
    logger,
    startedAt: Date.now(),
    adapters: adaptersByChannel(bound),
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
  await close();
});

describe("hub adapter registry (US-B45)", () => {
  it("connects with the Keychain item name from account_secrets, never a secret value", () => {
    expect(connects).toEqual([
      {
        channel: "gmail",
        accountExternalId: EXTERNAL_ID,
        keychainService: `omnis.gmail.refresh.${EXTERNAL_ID}`,
        keychainAccount: "281932556+jinhologankim@users.noreply.github.com",
      },
    ]);
  });

  it("skips an account whose secret row is missing", async () => {
    await pool.query(`DELETE FROM accounts WHERE channel = 'gmail' AND external_id = $1`, [
      "registry-no-secret",
    ]);
    await pool.query(
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail', $1, $1)`,
      ["registry-no-secret"],
    );
    const bound = await buildAdapters({
      accounts: await loadAccountRows(pool),
      factories: { gmail: fakeGmail },
      logger,
    });
    const ids = bound.map((b) => b.accountId);
    expect(ids).not.toHaveLength(0);
    const rows = await one<{ id: string }>(
      pool,
      `SELECT id FROM accounts WHERE channel = 'gmail' AND external_id = 'registry-no-secret'`,
    );
    expect(ids).not.toContain(rows.id);
  });

  // F2: before this, nothing in production reported a healthy adapter, so once a channel reached the
  // failure threshold its accounts stayed state='broken' — buildAdapters skipped them, so not even a
  // hub restart could rebuild the adapter. The connect path now reports healthy, which is the
  // ok=true branch of recordAdapterHealth: counter reset + broken→active + last_error cleared.
  it("brings a broken account back to active once its adapter connects", async () => {
    await pool.query(
      `UPDATE accounts SET state = 'broken', last_error = 'oauth revoked'
        WHERE channel = 'gmail' AND external_id = $1`,
      [EXTERNAL_ID],
    );
    const bound = await buildAdapters({
      accounts: await loadAccountRows(pool),
      factories: { gmail: fakeGmail },
      logger,
      // The same mapping main.ts wires: anything that is not "down" is ok=true.
      recordAdapterHealth: (h) =>
        recordAdapterHealth({ pool, logger }, h.channel as Channel, h.status !== "down", h.error),
    });
    expect(bound.map((b) => b.channel)).toContain("gmail");
    const row = await one<{ state: string; last_error: string | null }>(
      pool,
      `SELECT state, last_error FROM accounts WHERE channel = 'gmail' AND external_id = $1`,
      [EXTERNAL_ID],
    );
    expect(row.state).toBe("active");
    expect(row.last_error).toBeNull();
  });

  it("carries the registry's adapter into the archive write-back (US-A36)", async () => {
    archived.length = 0;
    const thread = await one<{ id: string }>(
      pool,
      `SELECT t.id FROM threads t JOIN accounts a ON a.id = t.account_id
        WHERE a.external_id = $1 AND t.external_id = $2`,
      [EXTERNAL_ID, THREAD_EXTERNAL_ID],
    );
    const res = await fetch(`${base}/api/threads/${thread.id}/archive`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ writeBack: "ok" });
    expect(archived).toEqual([{ accountId: expect.any(String), externalId: THREAD_EXTERNAL_ID }]);
  });
});
