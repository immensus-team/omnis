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
    message: "US-B11: Drive 폴링 ingestion",
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

  // ETag가 한 번 바뀌면 200이 per_page=50 한 페이지를 통째로 돌려준다. since를 올려두지 않으면
  // 이미 넣은 커밋까지 매번 T1 추출을 다시 돈다(upsertMemory는 행만 dedupe한다).
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
    // sinces에 없는 레포는 예전 평평한 since로 떨어진다 — 전체 히스토리를 걷지 않는다.
    expect(urls[1]).toContain("since=2026-09-01T00%3A00%3A00.000Z");
  });

  // A4 §10.1: 목록에 없는 레포는 API를 호출조차 하지 않는다.
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
