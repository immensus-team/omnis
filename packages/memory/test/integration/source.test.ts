import { createPool, one, query } from "@omnis/db";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEAD_LETTER_THRESHOLD,
  MAX_RETRY_AFTER_MS,
  RETRY_BACKOFF_MS,
  getSource,
  recordFailure,
  recordSuccess,
  saveCursor,
  withRetry,
  writeIngestSystemItem,
} from "../../src/ingest/source.js";

let pool: Pool;

beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});
afterEach(async () => {
  await query(pool, "DELETE FROM ingest_sources");
  await query(pool, "DELETE FROM items WHERE kind = 'system'");
  await query(pool, "DELETE FROM threads WHERE kind = 'system'");
  await query(pool, "DELETE FROM accounts WHERE channel = 'system'");
});

describe("getSource", () => {
  it("creates the row on first sight with an empty cursor", async () => {
    const s = await getSource(pool, "drive", "changes");
    expect(s.cursor).toEqual({});
    expect(s.fail_count).toBe(0);
    expect(s.last_ok_at).toBeNull();
    expect(s.last_error).toBeNull();
  });

  it("returns the same row (and id) the second time", async () => {
    const a = await getSource(pool, "github", "logankim/omnis");
    const b = await getSource(pool, "github", "logankim/omnis");
    expect(b.id).toBe(a.id);
    expect(await query(pool, "SELECT id FROM ingest_sources")).toHaveLength(1);
  });

  it("keeps sources of different kinds apart even with the same ref", async () => {
    const a = await getSource(pool, "file", "/Users/logan/notes");
    const b = await getSource(pool, "drive", "/Users/logan/notes");
    expect(b.id).not.toBe(a.id);
  });
});

describe("saveCursor / recordSuccess / recordFailure", () => {
  it("round-trips the cursor", async () => {
    const s = await getSource(pool, "drive", "changes");
    await saveCursor(pool, s.id, { pageToken: "tok-1", at: "2026-09-20T00:00:00.000Z" });
    expect((await getSource(pool, "drive", "changes")).cursor).toEqual({
      pageToken: "tok-1",
      at: "2026-09-20T00:00:00.000Z",
    });
  });

  it("counts failures and resets them on the next success", async () => {
    const s = await getSource(pool, "github", "logankim/omnis");
    expect(await recordFailure(pool, s.id, "403 rate limited")).toBe(1);
    expect(await recordFailure(pool, s.id, "403 rate limited")).toBe(2);
    expect((await getSource(pool, "github", "logankim/omnis")).last_error).toBe("403 rate limited");

    await recordSuccess(pool, s.id);
    const after = await getSource(pool, "github", "logankim/omnis");
    expect(after.fail_count).toBe(0);
    expect(after.last_error).toBeNull();
    expect(after.last_ok_at).not.toBeNull();
  });
});

describe("withRetry (A4 §10.5 1s → 4s → 16s)", () => {
  it("pins the three backoff steps", () => {
    expect(RETRY_BACKOFF_MS).toEqual([1000, 4000, 16000]);
  });

  it("returns on the first success without sleeping", async () => {
    const sleeps: number[] = [];
    const out = await withRetry(async () => "ok", { sleep: async (ms) => void sleeps.push(ms) });
    expect(out).toBe("ok");
    expect(sleeps).toEqual([]);
  });

  it("retries three times with the documented backoff and then rethrows", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("5xx");
        },
        { sleep: async (ms) => void sleeps.push(ms) },
      ),
    ).rejects.toThrow("5xx");
    expect(calls).toBe(4); // first attempt + 3 retries
    expect(sleeps).toEqual([1000, 4000, 16000]);
  });

  it("honours an explicit retry-after instead of the fixed backoff", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("429"), { retryAfterMs: 500 });
        return "ok";
      },
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(out).toBe("ok");
    expect(sleeps).toEqual([500]);
  });

  // Sleeping through an hour-long x-ratelimit-reset would stall the scheduler's other jobs too.
  it("caps an absurd retry-after so one rate-limited source cannot stall the scheduler", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("403"), { retryAfterMs: 3_600_000 });
        return "ok";
      },
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(out).toBe("ok");
    expect(sleeps).toEqual([MAX_RETRY_AFTER_MS]);
  });
});

describe("writeIngestSystemItem (A4 §10.5 dead-letter)", () => {
  it("lands one system item in the inbox with the source and the last error", async () => {
    const id = await writeIngestSystemItem(pool, {
      subject: "ingestion failed: github logankim/omnis",
      body: "source_kind=github source_ref=logankim/omnis\nlast error: 403 rate limited",
    });
    const row = await one<{ kind: string; status: string; subject: string; body: string }>(
      pool,
      "SELECT kind, status, subject, body FROM items WHERE id = $1",
      [id],
    );
    expect(row.kind).toBe("system");
    expect(row.status).toBe("received");
    expect(row.subject).toContain("github");
    expect(row.body).toContain("403 rate limited");
  });

  it("reuses one system account and thread instead of creating one per failure", async () => {
    await writeIngestSystemItem(pool, { subject: "a", body: "a" });
    await writeIngestSystemItem(pool, { subject: "b", body: "b" });
    expect(await query(pool, "SELECT id FROM accounts WHERE channel = 'system'")).toHaveLength(1);
    expect(await query(pool, "SELECT id FROM threads WHERE kind = 'system'")).toHaveLength(1);
  });

  it("pins the dead-letter threshold at three", () => {
    expect(DEAD_LETTER_THRESHOLD).toBe(3);
  });
});
