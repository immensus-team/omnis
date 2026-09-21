import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  SETTING_DEFAULTS,
  type SettingKey,
  getAllSettings,
  getSetting,
  setSetting,
} from "../src/settings.js";

/** `@omnis/db`'s query() calls pool.query(sql, params) and returns result.rows.
 * This fake mirrors that contract only — no real database is involved. */
function fakePool(rows: unknown[] = []) {
  const pool = { query: vi.fn().mockResolvedValue({ rows }) };
  return { pool: pool as unknown as Pool, query: pool.query };
}

describe("SETTING_DEFAULTS (US-B33)", () => {
  it("defaults every ingest.* allowlist key to an empty list", () => {
    const ingestKeys = (Object.keys(SETTING_DEFAULTS) as SettingKey[]).filter((key) =>
      key.startsWith("ingest."),
    );
    expect(ingestKeys).toEqual([
      "ingest.local_roots.mini",
      "ingest.local_roots.macbook",
      "ingest.drive_folders",
      "ingest.github_repos",
    ]);
    for (const key of ingestKeys) expect(SETTING_DEFAULTS[key]).toEqual([]);
  });

  it("caps cost at 60 usd and leaves cost.last_state unset", () => {
    expect(SETTING_DEFAULTS["cost.cap_usd"]).toBe(60);
    expect(SETTING_DEFAULTS["cost.last_state"]).toBeNull();
  });

  // US-D10: the detail pane's layout. The width's unset state is null and not a number, because
  // the width the shell ships with is a grid track at >=1280 and a sheet below it — a number here
  // would be a second answer to a question the CSS already answers.
  it("leaves the detail pane's width unset and its collapsed flag off", () => {
    expect(SETTING_DEFAULTS["ui.detail_width"]).toBeNull();
    expect(SETTING_DEFAULTS["ui.detail_collapsed"]).toBe(false);
  });
});

describe("getSetting", () => {
  it("returns the stored value when a row exists", async () => {
    const { pool, query } = fakePool([{ value: 80 }]);
    await expect(getSetting(pool, "cost.cap_usd", 60)).resolves.toBe(80);
    expect(query).toHaveBeenCalledWith("SELECT value FROM settings WHERE key = $1", [
      "cost.cap_usd",
    ]);
  });

  it("falls back to the given default when there is no row", async () => {
    const { pool } = fakePool([]);
    await expect(getSetting(pool, "cost.cap_usd", 60)).resolves.toBe(60);
  });

  it("treats a stored null as unset and uses the fallback", async () => {
    const { pool } = fakePool([{ value: null }]);
    await expect(getSetting(pool, "cost.last_state", "normal")).resolves.toBe("normal");
  });
});

describe("getAllSettings", () => {
  it("fills unset keys from SETTING_DEFAULTS and lets stored rows win", async () => {
    const { pool, query } = fakePool([{ key: "cost.cap_usd", value: 80 }]);
    const all = await getAllSettings(pool);

    expect(query).toHaveBeenCalledWith("SELECT key, value FROM settings", []);
    expect(Object.keys(all).sort()).toEqual((Object.keys(SETTING_DEFAULTS) as SettingKey[]).sort());
    expect(all["cost.cap_usd"]).toBe(80); // stored row overrides the default of 60
    expect(all["archive.enabled"]).toBe(true); // no row — comes from defaults
    expect(all["ingest.github_repos"]).toEqual([]);
  });

  it("returns every key even when the table is empty", async () => {
    const { pool } = fakePool([]);
    const all = await getAllSettings(pool);
    expect(all).toEqual(SETTING_DEFAULTS);
  });
});

describe("setSetting", () => {
  it("upserts the value and then writes the audit_log row (contract §5)", async () => {
    const { pool, query } = fakePool([]);
    await setSetting(pool, "cost.cap_usd", 80, "logan");

    expect(query).toHaveBeenCalledTimes(2);

    const upsert = query.mock.calls[0] ?? [];
    expect(upsert[0]).toContain("ON CONFLICT (key)");
    expect(upsert[1]).toEqual(["cost.cap_usd", JSON.stringify(80)]);

    const audit = query.mock.calls[1] ?? [];
    expect(audit[0]).toContain("INSERT INTO audit_log");
    expect(audit[1]).toEqual(["logan", "cost.cap_usd", JSON.stringify(80)]);
  });

  it("serializes non-scalar values once, identically for both queries", async () => {
    const { pool, query } = fakePool([]);
    const rules = [{ match: "vip", action: "notify" }];
    await setSetting(pool, "autonomy.rules", rules, "logan");

    const serialized = JSON.stringify(rules);
    expect(query.mock.calls[0]?.[1]).toEqual(["autonomy.rules", serialized]);
    expect(query.mock.calls[1]?.[1]).toEqual(["logan", "autonomy.rules", serialized]);
  });
});
