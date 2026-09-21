import { describe, expect, it, vi } from "vitest";
import { removeSubscription, saveSubscription } from "./push.js";

function fakePool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("saveSubscription", () => {
  it("upserts by endpoint and returns the row id", async () => {
    const pool = fakePool([{ id: "sub-1" }]);
    const id = await saveSubscription(pool as never, {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(id).toBe("sub-1");
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT (endpoint)"), [
      "https://push.example/abc",
      "p",
      "a",
      null,
    ]);
  });

  // Re-subscribing is the normal path, not the exception: Safari mints a new endpoint on every
  // install, and a browser that re-subscribes to the same endpoint sends fresh keys. If fail_count
  // survived the upsert, a subscription the sender had given up on would stay throttled forever.
  it("resets fail_count on re-subscribe and keeps ua when one is sent", async () => {
    const pool = fakePool([{ id: "sub-1" }]);
    await saveSubscription(pool as never, {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p2", auth: "a2" },
      ua: "iPhone Safari",
    });
    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("fail_count = 0");
    expect(params).toEqual(["https://push.example/abc", "p2", "a2", "iPhone Safari"]);
  });

  // delta §2.3 caps ua at 200 chars, and a browser with a 400-char user agent is not a reason to
  // refuse the subscription — so the cap is a truncation, applied here for every caller at once.
  it("truncates an over-long ua to the schema's 200 chars", async () => {
    const pool = fakePool([{ id: "sub-1" }]);
    await saveSubscription(pool as never, {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
      ua: "u".repeat(500),
    });
    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toHaveLength(200);
  });

  it("throws rather than returning undefined when the insert yields no row", async () => {
    const pool = fakePool([]);
    await expect(
      saveSubscription(pool as never, {
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p", auth: "a" },
      }),
    ).rejects.toThrow(/no row/);
  });
});

describe("removeSubscription", () => {
  it("returns true when a row was deleted", async () => {
    const pool = fakePool([{ id: "sub-1" }]);
    expect(await removeSubscription(pool as never, "https://push.example/abc")).toBe(true);
  });
  it("returns false when nothing matched", async () => {
    const pool = fakePool([]);
    expect(await removeSubscription(pool as never, "https://nope")).toBe(false);
  });
});
