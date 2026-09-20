// US-A36: POST /api/threads/:id/archive|unarchive — 행 + audit_log + durable 이벤트 + 어댑터 write-back.
import type { AddressInfo } from "node:net";
import { createPool, one, query } from "@omnis/db";
import { type Kernel, createKernel, createLogger } from "@omnis/kernel";
import type { Adapter, Capabilities, ThreadRef } from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
let archiveThrows: string | null = null;
const fakeGmail = {
  id: "fake-gmail",
  channel: "gmail",
  capabilities: () => caps(true),
  async archive(thread: ThreadRef) {
    if (archiveThrows !== null) throw new Error(archiveThrows);
    archived.push(thread);
  },
} as unknown as Adapter;
// Slack은 A1 §2.1대로 archive=false다 — capability가 없으면 write-back을 건너뛴다.
const fakeSlack = {
  id: "fake-slack",
  channel: "slack",
  capabilities: () => caps(false),
} as unknown as Adapter;

let pool: Pool;
let kernel: Kernel;
let base = "";
let close: () => Promise<void>;

async function makeThread(channel: string, externalId: string): Promise<string> {
  const account = await one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display, capabilities)
       VALUES ($1, $2, $2, '{"read":true,"write":true}'::jsonb)
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
     RETURNING id`,
    [channel, `archive-${channel}`],
  );
  const thread = await one<{ id: string }>(
    pool,
    `INSERT INTO threads (account_id, external_id, kind, title, last_item_at)
       VALUES ($1, $2, 'email', 'archive test', now()) RETURNING id`,
    [account.id, externalId],
  );
  return thread.id;
}

const post = (id: string, verb: "archive" | "unarchive"): Promise<Response> =>
  fetch(`${base}/api/threads/${id}/${verb}`, { method: "POST" });

const archivedAt = (id: string): Promise<Date | null> =>
  one<{ archived_at: Date | null }>(pool, "SELECT archived_at FROM threads WHERE id = $1", [
    id,
  ]).then((r) => r.archived_at);

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool, logger });
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
    },
    logger,
    startedAt: Date.now(),
    adapters: new Map([
      ["gmail", fakeGmail],
      ["slack", fakeSlack],
    ]),
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

describe("POST /threads/:id/archive", () => {
  it("sets archived_at, writes an audit row and emits a durable thread.updated", async () => {
    const id = await makeThread("slack", "C-archive-1");
    const seen: Record<string, unknown>[] = [];
    const unsubscribe = kernel.events.subscribe("omnis_thread", (p) => seen.push(p));
    try {
      const res = await post(id, "archive");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { archived_at: string | null; writeBack: string };
      expect(body.archived_at).not.toBeNull();
      expect(await archivedAt(id)).not.toBeNull();

      const audit = await one<{ n: string }>(
        pool,
        "SELECT count(*)::text AS n FROM audit_log WHERE action = 'thread.archived' AND target_id = $1 AND actor = 'me'",
        [id],
      );
      expect(Number(audit.n)).toBe(1);
      // NOTIFY는 LISTEN 커넥션을 한 번 도니까 잠깐 기다린다.
      await expect.poll(() => seen.some((p) => p.id === id), { timeout: 5_000 }).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it("is idempotent — a second archive keeps the first archived_at", async () => {
    const id = await makeThread("slack", "C-archive-2");
    await post(id, "archive");
    const first = await archivedAt(id);
    const res = await post(id, "archive");
    expect(res.status).toBe(200);
    expect((await archivedAt(id))?.getTime()).toBe(first?.getTime());
  });

  it("unarchive clears archived_at and audits it", async () => {
    const id = await makeThread("slack", "C-archive-3");
    await post(id, "archive");
    const res = await post(id, "unarchive");
    expect(res.status).toBe(200);
    expect((await res.json()) as { archived_at: null }).toMatchObject({ archived_at: null });
    expect(await archivedAt(id)).toBeNull();
    const audit = await one<{ n: string }>(
      pool,
      "SELECT count(*)::text AS n FROM audit_log WHERE action = 'thread.unarchived' AND target_id = $1",
      [id],
    );
    expect(Number(audit.n)).toBe(1);
  });

  it("404s on an unknown thread and 405s on GET", async () => {
    const missing = await post("00000000-0000-0000-0000-000000000000", "archive");
    expect(missing.status).toBe(404);
    const id = await makeThread("slack", "C-archive-4");
    const get = await fetch(`${base}/api/threads/${id}/archive`);
    expect(get.status).toBe(405);
  });
});

describe("archive write-back (마스터 §7: 승인 게이트 대상이 아니다)", () => {
  it("calls adapter.archive() when the channel declares the capability", async () => {
    const id = await makeThread("gmail", "G-archive-1");
    archived.length = 0;
    const res = await post(id, "archive");
    expect((await res.json()) as { writeBack: string }).toMatchObject({ writeBack: "ok" });
    expect(archived).toEqual([{ accountId: expect.any(String), externalId: "G-archive-1" }]);
  });

  it("skips channels without the capability (slack)", async () => {
    const id = await makeThread("slack", "C-archive-5");
    const res = await post(id, "archive");
    expect((await res.json()) as { writeBack: string }).toMatchObject({ writeBack: "skipped" });
  });

  it("keeps the local archive and leaves a system item when write-back fails", async () => {
    const id = await makeThread("gmail", "G-archive-2");
    archiveThrows = "gmail 429";
    try {
      const res = await post(id, "archive");
      expect((await res.json()) as { writeBack: string }).toMatchObject({ writeBack: "failed" });
    } finally {
      archiveThrows = null;
    }
    expect(await archivedAt(id)).not.toBeNull();
    const items = await query<{ body: string }>(
      pool,
      "SELECT body FROM items WHERE thread_id = $1 AND kind = 'system'",
      [id],
    );
    expect(items[0]?.body).toContain("gmail 429");
  });
});
