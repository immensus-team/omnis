import { describe, expect, it } from "vitest";
import { type DriveFetch, createDriveProvider } from "../src/ingest/drive.js";
import type { IngestDoc } from "../src/ingest/run.js";

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) out.push(d);
  return out;
}

function provider(handler: DriveFetch) {
  return createDriveProvider({ fetch: handler, accessToken: async () => "token" });
}

describe("createDriveProvider — 베이스라인", () => {
  it("takes a start page token on the first run and yields no content, only a cursor signal", async () => {
    const urls: string[] = [];
    const p = provider(async (url) => {
      urls.push(url);
      return json({ startPageToken: "100" });
    });
    const docs = await collect(p.list({ pool: {} as never, logger, cursor: {} }));
    // runIngest filters this signal doc out before it becomes a memory (run.ts); at the
    // provider level it is how nextCursor reaches saveCursor without a files.list rescan.
    expect(docs).toEqual([
      expect.objectContaining({ source_ref: "__drive_baseline__", text: null, deleted: false }),
    ]);
    expect(urls[0]).toContain("changes/startPageToken");
  });

  it("stores the baseline token so the next run polls changes", async () => {
    const p = provider(async (url) =>
      url.includes("startPageToken")
        ? json({ startPageToken: "100" })
        : json({ changes: [], newStartPageToken: "101" }),
    );
    const first = p.list({ pool: {} as never, logger, cursor: {} });
    const baselineDocs: IngestDoc[] = [];
    for await (const d of first) baselineDocs.push(d);
    expect(baselineDocs).toHaveLength(1);
    expect(baselineDocs[0]?.nextCursor).toEqual({ pageToken: "100" });
  });
});

describe("createDriveProvider — 변경 폴링", () => {
  const change = (id: string, name: string, mime: string, removed = false) => ({
    fileId: id,
    removed,
    file: removed
      ? undefined
      : { id, name, mimeType: mime, modifiedTime: "2026-09-20T00:00:00.000Z", trashed: false },
  });

  it("emits one doc per changed text file, with the drive fileId as source_ref", async () => {
    const p = provider(async (url) => {
      if (url.includes("startPageToken")) return json({ startPageToken: "100" });
      if (url.includes("alt=media")) return new Response("드라이브 본문", { status: 200 });
      return json({
        changes: [change("f1", "notes.md", "text/markdown")],
        newStartPageToken: "101",
      });
    });
    const docs = await collect(p.list({ pool: {} as never, logger, cursor: { pageToken: "100" } }));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.source_ref).toBe("f1");
    expect(docs[0]?.text).toBe("드라이브 본문");
    expect(docs[0]?.validFrom).toBe("2026-09-20T00:00:00.000Z");
    expect(docs[0]?.nextCursor).toEqual({ pageToken: "101" });
  });

  it("asks for removed items and turns a tombstone into a deletion", async () => {
    let changesUrl = "";
    const p = provider(async (url) => {
      if (url.includes("startPageToken")) return json({ startPageToken: "100" });
      changesUrl = url;
      return json({ changes: [change("f2", "", "", true)], newStartPageToken: "102" });
    });
    const docs = await collect(p.list({ pool: {} as never, logger, cursor: { pageToken: "100" } }));
    expect(changesUrl).toContain("includeRemoved=true");
    expect(docs[0]).toMatchObject({ source_ref: "f2", text: null, deleted: true });
  });

  it("treats a trashed file as a deletion too", async () => {
    const p = provider(async (url) => {
      if (url.includes("startPageToken")) return json({ startPageToken: "100" });
      return json({
        changes: [
          {
            fileId: "f3",
            removed: false,
            file: {
              id: "f3",
              name: "x.md",
              mimeType: "text/markdown",
              modifiedTime: "2026-09-20T00:00:00.000Z",
              trashed: true,
            },
          },
        ],
        newStartPageToken: "103",
      });
    });
    const docs = await collect(p.list({ pool: {} as never, logger, cursor: { pageToken: "100" } }));
    expect(docs[0]?.deleted).toBe(true);
  });

  it("skips binary mime types without downloading them", async () => {
    let downloaded = false;
    const p = provider(async (url) => {
      if (url.includes("startPageToken")) return json({ startPageToken: "100" });
      if (url.includes("alt=media")) {
        downloaded = true;
        return new Response("", { status: 200 });
      }
      return json({
        changes: [change("f4", "deck.pdf", "application/pdf")],
        newStartPageToken: "104",
      });
    });
    const docs = await collect(p.list({ pool: {} as never, logger, cursor: { pageToken: "100" } }));
    expect(downloaded).toBe(false);
    expect(docs).toEqual([]);
  });

  it("follows nextPageToken across pages", async () => {
    let page = 0;
    const p = provider(async (url) => {
      if (url.includes("startPageToken")) return json({ startPageToken: "100" });
      if (url.includes("alt=media")) return new Response("본문", { status: 200 });
      page += 1;
      return page === 1
        ? json({ changes: [change("f5", "a.md", "text/markdown")], nextPageToken: "200" })
        : json({ changes: [change("f6", "b.md", "text/markdown")], newStartPageToken: "201" });
    });
    const docs = await collect(p.list({ pool: {} as never, logger, cursor: { pageToken: "100" } }));
    expect(docs.map((d) => d.source_ref)).toEqual(["f5", "f6"]);
    expect(docs[1]?.nextCursor).toEqual({ pageToken: "201" });
  });
});

describe("createDriveProvider — 토큰 유실 (A4 §10.5)", () => {
  it("re-baselines on 404 instead of rescanning everything", async () => {
    const urls: string[] = [];
    const p = provider(async (url) => {
      urls.push(url);
      if (url.includes("startPageToken")) return json({ startPageToken: "500" });
      return json({ error: { code: 404, message: "pageToken not found" } }, 404);
    });
    const docs = await collect(
      p.list({ pool: {} as never, logger, cursor: { pageToken: "stale" } }),
    );
    expect(docs).toEqual([
      expect.objectContaining({ source_ref: "__drive_baseline__", text: null, deleted: false }),
    ]);
    expect(urls.some((u) => u.includes("startPageToken"))).toBe(true);
    // 전체 재스캔(files.list)은 절대 부르지 않는다.
    expect(urls.some((u) => u.includes("/files?"))).toBe(false);
  });

  it("propagates a 5xx so withRetry and the failure counter see it", async () => {
    const p = provider(async (url) =>
      url.includes("startPageToken") ? json({ startPageToken: "100" }) : json({}, 503),
    );
    await expect(
      collect(p.list({ pool: {} as never, logger, cursor: { pageToken: "100" } })),
    ).rejects.toThrow(/503/);
  });
});
