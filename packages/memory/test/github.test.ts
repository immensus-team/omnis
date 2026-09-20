import { describe, expect, it } from "vitest";
import {
  type GithubFetch,
  GithubRateLimitError,
  createGithubProvider,
} from "../src/ingest/github.js";
import type { IngestDoc } from "../src/ingest/run.js";

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) out.push(d);
  return out;
}

const COMMIT = {
  sha: "abc1234",
  html_url: "https://github.com/logankim/omnis/commit/abc1234",
  commit: {
    message: "US-B11: Drive polling ingestion",
    author: { name: "Logan", date: "2026-09-20T00:00:00.000Z" },
  },
};

function provider(handler: GithubFetch, repos = ["logankim/omnis"]) {
  return createGithubProvider({ fetch: handler, token: async () => "pat", repos });
}

describe("createGithubProvider", () => {
  it("emits one doc per commit with the commit url as source_ref", async () => {
    const p = provider(
      async () =>
        new Response(JSON.stringify([COMMIT]), {
          status: 200,
          headers: { "content-type": "application/json", etag: 'W/"v1"' },
        }),
    );
    const docs = await collect(p.list({ pool: {} as never, logger, cursor: {} }));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.source_ref).toBe(COMMIT.html_url);
    expect(docs[0]?.text).toContain("US-B11");
    expect(docs[0]?.text).toContain("Logan");
    expect(docs[0]?.validFrom).toBe("2026-09-20T00:00:00.000Z");
  });

  it("sends If-None-Match once it has an etag and yields nothing on 304", async () => {
    const headers: Array<Record<string, string>> = [];
    const p = provider(async (_url, init) => {
      headers.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(null, { status: 304 });
    });
    const docs = await collect(
      p.list({ pool: {} as never, logger, cursor: { etags: { "logankim/omnis": 'W/"v1"' } } }),
    );
    expect(docs).toEqual([]);
    expect(headers[0]?.["if-none-match"]).toBe('W/"v1"');
  });

  it("stores the new etag in the cursor", async () => {
    const p = provider(
      async () =>
        new Response(JSON.stringify([COMMIT]), {
          status: 200,
          headers: { "content-type": "application/json", etag: 'W/"v2"' },
        }),
    );
    const docs = await collect(p.list({ pool: {} as never, logger, cursor: {} }));
    expect(docs[0]?.nextCursor).toEqual({
      etags: { "logankim/omnis": 'W/"v2"' },
      sinces: { "logankim/omnis": "2026-09-20T00:00:00.000Z" },
    });
  });

  // Once an ETag changes, a 200 hands back a whole per_page=50 page. Without advancing since,
  // every poll re-runs T1 extraction over commits that were already ingested (upsertMemory only
  // dedupes rows).
  it("advances since per repo to the newest commit it saw", async () => {
    const older = {
      ...COMMIT,
      sha: "old",
      commit: { ...COMMIT.commit, author: { name: "Logan", date: "2026-09-19T00:00:00.000Z" } },
    };
    const p = provider(
      async () =>
        new Response(JSON.stringify([COMMIT, older]), {
          status: 200,
          headers: { "content-type": "application/json", etag: 'W/"v3"' },
        }),
    );
    const docs = await collect(p.list({ pool: {} as never, logger, cursor: {} }));
    expect(docs.at(-1)?.nextCursor).toMatchObject({
      sinces: { "logankim/omnis": "2026-09-20T00:00:00.000Z" },
    });
  });

  it("prefers the per-repo since over the legacy flat one", async () => {
    const urls: string[] = [];
    const p = provider(
      async (url) => {
        urls.push(url);
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      },
      ["logankim/omnis", "onwardlab/iro"],
    );
    await collect(
      p.list({
        pool: {} as never,
        logger,
        cursor: {
          since: "2026-09-01T00:00:00.000Z",
          sinces: { "logankim/omnis": "2026-09-20T00:00:00.000Z" },
        },
      }),
    );
    expect(urls[0]).toContain("since=2026-09-20T00%3A00%3A00.000Z");
    // A repo missing from sinces falls back to the old flat since — the whole history is not walked.
    expect(urls[1]).toContain("since=2026-09-01T00%3A00%3A00.000Z");
  });

  // A4 §10.1: repos that are not on the list are never called against the API at all.
  it("never calls the api when the repo allowlist is empty", async () => {
    let called = false;
    const p = provider(async () => {
      called = true;
      return new Response("[]", { status: 200 });
    }, []);
    expect(await collect(p.list({ pool: {} as never, logger, cursor: {} }))).toEqual([]);
    expect(called).toBe(false);
  });

  it("polls every repo in the allowlist", async () => {
    const urls: string[] = [];
    const p = provider(
      async (url) => {
        urls.push(url);
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      },
      ["logankim/omnis", "onwardlab/iro"],
    );
    await collect(p.list({ pool: {} as never, logger, cursor: {} }));
    expect(urls.some((u) => u.includes("logankim/omnis"))).toBe(true);
    expect(urls.some((u) => u.includes("onwardlab/iro"))).toBe(true);
  });

  it("throws GithubRateLimitError carrying retryAfterMs from x-ratelimit-reset", async () => {
    const reset = Math.floor(Date.now() / 1000) + 30;
    const p = provider(
      async () =>
        new Response("rate limited", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
        }),
    );
    const err = await collect(p.list({ pool: {} as never, logger, cursor: {} })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(GithubRateLimitError);
    expect((err as GithubRateLimitError).retryAfterMs).toBeGreaterThan(20_000);
    expect((err as GithubRateLimitError).retryAfterMs).toBeLessThan(40_000);
  });

  it("propagates a 5xx as a plain error so withRetry backs off normally", async () => {
    const p = provider(async () => new Response("boom", { status: 502 }));
    await expect(collect(p.list({ pool: {} as never, logger, cursor: {} }))).rejects.toThrow(/502/);
  });

  it("uses since from the cursor so the first poll does not walk the whole history", async () => {
    const urls: string[] = [];
    const p = provider(async (url) => {
      urls.push(url);
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });
    await collect(
      p.list({ pool: {} as never, logger, cursor: { since: "2026-09-01T00:00:00.000Z" } }),
    );
    expect(urls[0]).toContain("since=2026-09-01T00%3A00%3A00.000Z");
  });
});
