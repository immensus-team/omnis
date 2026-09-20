import { MIGRATIONS_DIR, NOTIFY_CHANNELS, createPool } from "@omnis/db";
import { describe, expect, it } from "vitest";

describe("createPool", () => {
  it("throws when DATABASE_URL is missing", () => {
    expect(() => createPool({})).toThrow(/DATABASE_URL/);
  });

  it("uses the given env and tags the connection", async () => {
    const pool = createPool({ DATABASE_URL: "postgres://nobody@127.0.0.1:5432/nothing" });
    try {
      expect(pool.options.max).toBe(10);
      expect(pool.options.application_name).toBe("omnis-hub");
    } finally {
      await pool.end();
    }
  });
});

describe("constants", () => {
  it("points MIGRATIONS_DIR at packages/db/migrations", () => {
    expect(MIGRATIONS_DIR.endsWith("/packages/db/migrations")).toBe(true);
  });

  it("lists the 7 NOTIFY channels from A3 §6.2", () => {
    expect([...NOTIFY_CHANNELS]).toEqual([
      "omnis_item",
      "omnis_thread",
      "omnis_approval",
      "omnis_task",
      "omnis_session",
      "omnis_job",
      "omnis_control",
    ]);
  });
});
