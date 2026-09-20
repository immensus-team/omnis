import { createPool, one, query } from "@omnis/db";
import { type Events, createEvents, createLogger } from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let events: Events & { close(): Promise<void> };

beforeAll(() => {
  pool = createPool();
  events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
});
afterAll(async () => {
  await events.close();
  await pool.end();
});

function waitFor<T>(get: () => T | undefined, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const v = get();
      if (v !== undefined) {
        clearInterval(tick);
        resolve(v);
      } else if (Date.now() - started > ms) {
        clearInterval(tick);
        reject(new Error("timed out waiting for event"));
      }
    }, 25);
  });
}

describe("events — ephemeral tier", () => {
  it("delivers in-process only: no row, no NOTIFY", async () => {
    const got: Array<Record<string, unknown>> = [];
    const off = events.subscribe("turn.item.delta", (p) => got.push(p));

    const before = await one<{ n: string }>(pool, "SELECT count(*)::text AS n FROM events");
    await events.emit("ephemeral", "turn.item.delta", { id: "t-1", text: "hel" });
    await events.emit("ephemeral", "turn.item.delta", { id: "t-1", text: "lo" });
    const after = await one<{ n: string }>(pool, "SELECT count(*)::text AS n FROM events");

    expect(got).toEqual([
      { id: "t-1", text: "hel" },
      { id: "t-1", text: "lo" },
    ]);
    expect(after.n).toBe(before.n);

    off();
    await events.emit("ephemeral", "turn.item.delta", { id: "t-1", text: "!" });
    expect(got).toHaveLength(2);
  });
});

describe("events — durable tier", () => {
  it("notifies the mapped channel with the id-only payload", async () => {
    let received: Record<string, unknown> | undefined;
    const off = events.subscribe("omnis_control", (p) => {
      received = p;
    });
    await events.emit("durable", "control.kill_switch", { kill_switch: true });
    const got = await waitFor(() => received);
    expect(got).toEqual({ kill_switch: true });
    off();
  });

  it("refuses an unmapped kind and an oversized payload", async () => {
    await expect(events.emit("durable", "not.a.kind", { id: "x" })).rejects.toThrow(
      /no NOTIFY channel/,
    );
    await expect(
      events.emit("durable", "control.kill_switch", { id: "x", blob: "y".repeat(8100) }),
    ).rejects.toThrow(/NOTIFY payload/);
  });
});

describe("events — cold tier", () => {
  it("inserts into events and never notifies", async () => {
    let leaked = false;
    const off = events.subscribe("omnis_item", () => {
      leaked = true;
    });
    await events.emit("cold", "adapter.error", {
      id: "11111111-1111-1111-1111-111111111111",
      actor: "system",
      target_table: "accounts",
      reason: "rate limited",
    });
    const row = await one<{
      kind: string;
      actor: string;
      target_table: string;
      payload: Record<string, unknown>;
    }>(
      pool,
      `SELECT kind, actor, target_table, payload FROM events WHERE kind = 'adapter.error' ORDER BY seq DESC LIMIT 1`,
    );
    expect(row.actor).toBe("system");
    expect(row.target_table).toBe("accounts");
    expect(row.payload.reason).toBe("rate limited");
    await new Promise((r) => setTimeout(r, 150));
    expect(leaked).toBe(false);
    off();
  });
});

describe("events — subscribe", () => {
  it("rejects an unknown NOTIFY-looking channel", () => {
    expect(() => events.subscribe("omnis_bogus", () => undefined)).toThrow(
      /unknown omnis_ channel/,
    );
  });

  it("keeps other subscribers alive when one throws", async () => {
    const seen: string[] = [];
    const offA = events.subscribe("local.test", () => {
      throw new Error("boom");
    });
    const offB = events.subscribe("local.test", () => seen.push("b"));
    await events.emit("ephemeral", "local.test", {});
    expect(seen).toEqual(["b"]);
    offA();
    offB();
    await query(pool, "SELECT 1");
  });
});
