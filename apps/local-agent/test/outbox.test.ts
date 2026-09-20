import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Outbox } from "../src/outbox.js";

const newPath = () => join(mkdtempSync(join(tmpdir(), "omnis-outbox-")), "outbox.ndjson");

describe("Outbox", () => {
  it("replays durable entries in order and empties itself", async () => {
    const o = new Outbox({ path: newPath() });
    o.append({ method: "turn.item.started", params: { item_id: "i1" } });
    o.append({ method: "turn.completed", params: { turn_id: "t1" } });
    const seen: string[] = [];
    await o.drain(async (e) => { seen.push(e.method); });
    expect(seen).toEqual(["turn.item.started", "turn.completed"]);
    expect(o.length()).toBe(0);
  });

  it("drops the oldest entries past the cap but never an approval.requested", () => {
    const o = new Outbox({ path: newPath(), maxBytes: 400 });
    o.append({ method: "approval.requested", params: { turn_id: "keep-me" } });
    for (let i = 0; i < 20; i++) o.append({ method: "turn.item.completed", params: { item_id: `i${i}`, body: "x".repeat(40) } });
    const kept = o.entries().map((e) => e.method);
    expect(kept).toContain("approval.requested");
    expect(o.sizeBytes()).toBeLessThanOrEqual(400);
  });

  it("keeps unflushed entries when the sender throws", async () => {
    const o = new Outbox({ path: newPath() });
    o.append({ method: "turn.item.started", params: { item_id: "i1" } });
    o.append({ method: "turn.item.completed", params: { item_id: "i1" } });
    await expect(o.drain(async (e) => { if (e.method === "turn.item.completed") throw new Error("socket closed"); })).rejects.toThrow("socket closed");
    expect(o.entries().map((e) => e.method)).toEqual(["turn.item.completed"]);
  });
});
