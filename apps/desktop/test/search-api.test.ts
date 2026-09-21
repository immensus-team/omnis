// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts, so this file declares its own
// environment and setup (same situation as the other desktop tests).
import "./setup";

import { afterEach, describe, expect, it, vi } from "vitest";
import { type SearchResponse, search, toUiSearchGroups } from "../src/api/search.js";

const response = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

describe("search (contract §7 GET /search)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /search?q=... and returns the parsed SearchResponse", async () => {
    const body = { q: "davich", took_ms: 12, groups: [], truncated: false };
    const fetchMock = vi.fn(async () => response(body));
    vi.stubGlobal("fetch", fetchMock);
    const result = await search("davich");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/search?q=davich");
    expect(result).toEqual(body);
  });

  it("appends k when given", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ q: "davich", took_ms: 1, groups: [], truncated: false })),
    );
    await search("davich", { k: 3 });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("http://127.0.0.1:8787/search?q=davich&k=3");
  });

  it("carries scope and since through when they are set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ q: "q", took_ms: 1, groups: [], truncated: false })),
    );
    await search("q", { scope: "work", since: "2026-09-01T00:00:00.000Z" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/search?q=q&scope=work&since=2026-09-01T00%3A00%3A00.000Z",
    );
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await expect(search("davich")).rejects.toThrow(/500/);
  });
});

describe("toUiSearchGroups (A5 §2.5 — what the palette renders)", () => {
  const hit = (kind: "person" | "thread" | "item" | "memory", id: string, deepLink: unknown) => ({
    kind,
    id,
    score: 1,
    title: `${kind} title`,
    snippet: `${kind} snippet`,
    at: null,
    channel: null,
    deep_link: deepLink,
  });

  const full: SearchResponse = {
    q: "davich",
    took_ms: 5,
    truncated: false,
    groups: [
      {
        kind: "people",
        total: 1,
        results: [hit("person", "p1", { screen: "person", person_id: "p1" })],
      },
      {
        kind: "memories",
        total: 2,
        results: [
          hit("memory", "m1", null),
          hit("memory", "m2", { screen: "thread", item_id: "i9" }),
        ],
      },
    ],
  };

  it("labels every group the hub sent and keeps the hub's kind", () => {
    const groups = toUiSearchGroups(full);
    expect(groups.map((g) => [g.kind, g.label])).toEqual([
      ["people", "People"],
      ["memories", "Memories"],
    ]);
  });

  it("disables exactly the hits whose deep_link is null (A5 §2.5)", () => {
    const [people, memories] = toUiSearchGroups(full);
    expect(people?.results.map((r) => r.deepLinkDisabled)).toEqual([false]);
    expect(memories?.results.map((r) => r.deepLinkDisabled)).toEqual([true, false]);
  });

  it("has a label for all four of the hub's group kinds", () => {
    const groups = toUiSearchGroups({
      q: "x",
      took_ms: 1,
      truncated: false,
      groups: [
        { kind: "people", total: 0, results: [] },
        { kind: "threads", total: 0, results: [] },
        { kind: "items", total: 0, results: [] },
        { kind: "memories", total: 0, results: [] },
      ],
    });
    expect(groups.map((g) => g.label)).toEqual(["People", "Threads", "Items", "Memories"]);
  });

  it("returns an empty list for a response with no groups", () => {
    expect(toUiSearchGroups({ q: "x", took_ms: 0, groups: [], truncated: false })).toEqual([]);
  });
});
