// delta §5/§6 (US-B33). Goes through the real DB, not unit mocks — the 0009 seed, its triggers
// and the jsonb round-trip all come out in one pass.
import { createPool, query } from "@omnis/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SETTING_DEFAULTS, getAllSettings, getSetting, setSetting } from "../../src/settings.js";

const pool = createPool();
afterAll(() => pool.end());

// An append-only trigger blocks DELETE on audit_log (0006 §6.1) — a watermark narrows the view
// to this test's own rows.
let auditFrom = 0;

beforeEach(async () => {
  const [{ seq }] = await query<{ seq: string }>(
    pool,
    "SELECT COALESCE(max(seq), 0)::text AS seq FROM audit_log",
  );
  auditFrom = Number(seq);
  await query(pool, "UPDATE settings SET value = '60'::jsonb WHERE key = 'cost.cap_usd'");
  await query(pool, "DELETE FROM settings WHERE key = 'cost.last_state'");
});

describe("SETTING_DEFAULTS", () => {
  it("has every allowlist key defaulting to an empty array (contract §5)", () => {
    expect(SETTING_DEFAULTS["ingest.local_roots.mini"]).toEqual([]);
    expect(SETTING_DEFAULTS["ingest.local_roots.macbook"]).toEqual([]);
    expect(SETTING_DEFAULTS["ingest.drive_folders"]).toEqual([]);
    expect(SETTING_DEFAULTS["ingest.github_repos"]).toEqual([]);
  });

  it("defaults the cost cap to 60 and covers the internal cost.last_state key", () => {
    expect(SETTING_DEFAULTS["cost.cap_usd"]).toBe(60);
    expect(SETTING_DEFAULTS["cost.last_state"]).toBeNull();
  });
});

describe("0009_settings.sql seed", () => {
  it("seeds every SettingKey except the internal cost.last_state", async () => {
    const rows = await query<{ key: string }>(pool, "SELECT key FROM settings ORDER BY key");
    const seeded = rows.map((r) => r.key);
    const expected = Object.keys(SETTING_DEFAULTS)
      .filter((k) => k !== "cost.last_state")
      .sort();
    expect(seeded).toEqual(expected);
  });
});

describe("getSetting", () => {
  it("returns the stored value when a row exists", async () => {
    expect(await getSetting(pool, "cost.cap_usd", 999)).toBe(60);
  });

  it("falls back to the given default when no row exists", async () => {
    expect(await getSetting(pool, "cost.last_state", "normal")).toBe("normal");
  });
});

describe("setSetting", () => {
  it("upserts an existing key and writes an audit_log row", async () => {
    await setSetting(pool, "cost.cap_usd", 80, "me");
    expect(await getSetting(pool, "cost.cap_usd", 60)).toBe(80);

    const audit = await query<{ actor: string; after: { key: string; value: unknown } }>(
      pool,
      "SELECT actor, after FROM audit_log WHERE action = 'settings.set' AND seq > $1",
      [auditFrom],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor).toBe("me");
    expect(audit[0]?.after).toEqual({ key: "cost.cap_usd", value: 80 });
  });

  it("inserts a key that was never seeded and round-trips objects", async () => {
    await setSetting(pool, "cost.last_state", "degraded", "system");
    expect(await getSetting(pool, "cost.last_state", null)).toBe("degraded");

    await setSetting(pool, "notify.quiet_hours", { start: "22:00", end: "08:00" }, "me");
    expect(await getSetting(pool, "notify.quiet_hours", null)).toEqual({
      start: "22:00",
      end: "08:00",
    });
    await setSetting(pool, "notify.quiet_hours", SETTING_DEFAULTS["notify.quiet_hours"], "me");
  });

  it("bumps updated_at via the ON CONFLICT branch", async () => {
    const before = await query<{ updated_at: Date }>(
      pool,
      "SELECT updated_at FROM settings WHERE key = 'cost.cap_usd'",
    );
    await setSetting(pool, "cost.cap_usd", 70, "me");
    const after = await query<{ updated_at: Date }>(
      pool,
      "SELECT updated_at FROM settings WHERE key = 'cost.cap_usd'",
    );
    expect(after[0]?.updated_at.getTime()).toBeGreaterThanOrEqual(
      before[0]?.updated_at.getTime() ?? 0,
    );
  });
});

describe("getAllSettings", () => {
  it("returns every SettingKey, falling back to SETTING_DEFAULTS for unset ones", async () => {
    await setSetting(pool, "cost.cap_usd", 90, "me");
    const all = await getAllSettings(pool);
    expect(Object.keys(all).sort()).toEqual(Object.keys(SETTING_DEFAULTS).sort());
    expect(all["cost.cap_usd"]).toBe(90);
    expect(all["archive.enabled"]).toBe(true);
    expect(all["ingest.github_repos"]).toEqual([]);
    expect(all["cost.last_state"]).toBeNull();
  });
});

// delta §6: there is no new NOTIFY channel — settings changes ride on the existing omnis_control.
describe("settings_notify trigger", () => {
  it('publishes {"settings":"<key>"} on omnis_control', async () => {
    const c = await pool.connect();
    try {
      const got = new Promise<string>((resolve) => {
        c.on("notification", (n) => {
          if (n.channel === "omnis_control" && n.payload?.includes("settings")) {
            resolve(n.payload);
          }
        });
      });
      await c.query("LISTEN omnis_control");
      await setSetting(pool, "archive.enabled", false, "me");
      expect(JSON.parse(await got)).toEqual({ settings: "archive.enabled" });
    } finally {
      await setSetting(pool, "archive.enabled", true, "me");
      c.release();
    }
  });
});
