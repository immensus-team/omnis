import { describe, expect, it } from "vitest";
import { type SearchDeps, buildGroup, mergedScore, normalizeScores, runSearch } from "./search.js";

describe("normalizeScores (A4 §14.3 in-group 0..1 normalisation)", () => {
  it("divides by the group max", () => {
    expect(normalizeScores([2, 4, 1])).toEqual([0.5, 1, 0.25]);
  });
  it("returns all zeros when every raw score is 0 (no div-by-zero)", () => {
    expect(normalizeScores([0, 0])).toEqual([0, 0]);
  });
});

describe("mergedScore (A4 §14.3 score = group_weight x norm + 0.25 x recency + 0.15 x vip)", () => {
  it("adds the full recency + vip bump for a same-instant VIP hit", () => {
    const now = new Date("2026-09-20T00:00:00Z");
    expect(mergedScore(1.0, 1, now.toISOString(), true, now)).toBeCloseTo(1 + 0.25 + 0.15, 5);
  });
  it("decays recency toward 0 as the hit ages (90-day exponential decay)", () => {
    const now = new Date("2026-09-20T00:00:00Z");
    const oldIso = new Date("2025-09-20T00:00:00Z").toISOString();
    const fresh = mergedScore(1, 0, now.toISOString(), false, now);
    const stale = mergedScore(1, 0, oldIso, false, now);
    expect(stale).toBeLessThan(fresh);
  });
  it("scores a null timestamp (self-model memory) as zero recency", () => {
    const now = new Date("2026-09-20T00:00:00Z");
    expect(mergedScore(1, 0, null, false, now)).toBe(0);
  });
});

describe("buildGroup (at most 5 per group, total counts the pre-cap hits)", () => {
  it("caps results at 5, sorts by score desc, keeps the true total", () => {
    const hits = Array.from({ length: 8 }, (_, i) => ({
      kind: "item" as const,
      id: String(i),
      score: i,
      title: "t",
      snippet: "s",
      at: null,
      channel: null,
      deep_link: null,
    }));
    const group = buildGroup("items", hits);
    expect(group.total).toBe(8);
    expect(group.results).toHaveLength(5);
    expect(group.results[0]?.id).toBe("7");
  });
});

function fakeDeps(overrides: Partial<SearchDeps> = {}): SearchDeps {
  return {
    searchItems: async () => [],
    searchThreads: async () => [],
    searchPeople: async () => [],
    searchMemories: async () => [],
    ...overrides,
  };
}

describe("runSearch (A4 §14.4 fixed group order people -> threads -> items -> memories)", () => {
  it("returns all 4 groups in fixed order even when everything is empty", async () => {
    const res = await runSearch(fakeDeps(), { q: "davich" });
    expect(res.groups.map((g) => g.kind)).toEqual(["people", "threads", "items", "memories"]);
    expect(res.q).toBe("davich");
    expect(res.truncated).toBe(false);
  });

  it("nulls deep_link for a memory with no source item (self-model fact)", async () => {
    const res = await runSearch(
      fakeDeps({
        searchMemories: async () => [
          {
            memory_id: "m1",
            content: "prefers morning meetings",
            score: 0.9,
            recorded_at: "2026-09-01T00:00:00Z",
            valid_from: "2026-09-01T00:00:00Z",
            valid_until: null,
            source_item_id: null,
            source_kind: "self",
            source_ref: null,
          },
        ],
      }),
      { q: "meeting" },
    );
    const memories = res.groups.find((g) => g.kind === "memories");
    expect(memories?.results[0]?.deep_link).toBeNull();
    expect(memories?.results[0]?.source_kind).toBe("self");
  });

  it("deep_links a memory that does have a source item back to that item", async () => {
    const res = await runSearch(
      fakeDeps({
        searchMemories: async () => [
          {
            memory_id: "m2",
            content: "contract signed on the 19th",
            score: 0.7,
            recorded_at: "2026-09-19T00:00:00Z",
            valid_from: "2026-09-19T00:00:00Z",
            valid_until: null,
            source_item_id: "i9",
            source_kind: "inbox",
            source_ref: null,
          },
        ],
      }),
      { q: "contract" },
    );
    const memories = res.groups.find((g) => g.kind === "memories");
    expect(memories?.results[0]?.deep_link).toEqual({ screen: "thread", item_id: "i9" });
  });

  it("deep_links an item hit to its thread and carries the channel", async () => {
    const res = await runSearch(
      fakeDeps({
        searchItems: async () => [
          {
            id: "i1",
            thread_id: "t1",
            subject: "Contract request",
            body: "Please review and confirm.",
            sent_at: "2026-09-19T09:00:00Z",
            channel: "gmail",
          },
        ],
      }),
      { q: "contract" },
    );
    const items = res.groups.find((g) => g.kind === "items");
    expect(items?.results[0]?.deep_link).toEqual({
      screen: "thread",
      thread_id: "t1",
      item_id: "i1",
    });
    expect(items?.results[0]?.channel).toBe("gmail");
    expect(items?.results[0]?.title).toBe("Contract request");
  });

  it("passes the thread ids of the item hits to searchThreads (A4 §14.2 roll-up)", async () => {
    let seen: readonly string[] = [];
    await runSearch(
      fakeDeps({
        searchItems: async () => [
          {
            id: "i1",
            thread_id: "t1",
            subject: null,
            body: "b",
            sent_at: "2026-09-19T09:00:00Z",
            channel: "slack",
          },
          {
            id: "i2",
            thread_id: "t1",
            subject: null,
            body: "b",
            sent_at: "2026-09-19T09:00:00Z",
            channel: "slack",
          },
        ],
        searchThreads: async (_q, ids) => {
          seen = ids;
          return [];
        },
      }),
      { q: "b" },
    );
    expect(seen).toEqual(["t1"]);
  });

  it("gives a thread with a VIP participant the 0.15 bump (A4 §14.3)", async () => {
    const now = new Date("2026-09-20T00:00:00Z");
    const thread = (id: string, vip: boolean) => ({ id, title: "t", last_item_at: null, vip });
    const score = async (vip: boolean) => {
      const res = await runSearch(fakeDeps({ searchThreads: async () => [thread("t1", vip)] }), {
        q: "x",
        now,
      });
      return res.groups.find((g) => g.kind === "threads")?.results[0]?.score ?? 0;
    };
    expect((await score(true)) - (await score(false))).toBeCloseTo(0.15, 5);
  });

  it("marks the response truncated when a group overflows the cap of 5", async () => {
    const res = await runSearch(
      fakeDeps({
        searchPeople: async () =>
          Array.from({ length: 6 }, (_, i) => ({
            id: `p${i}`,
            display_name: `Person ${i}`,
            last_contact_at: null,
            vip: false,
          })),
      }),
      { q: "person" },
    );
    const people = res.groups.find((g) => g.kind === "people");
    expect(people?.total).toBe(6);
    expect(people?.results).toHaveLength(5);
    expect(res.truncated).toBe(true);
  });
});
