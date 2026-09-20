import type { IngestReadResult, IngestScanResult } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import { type BridgeCall, createLocalMacbookProvider } from "../src/ingest/local-macbook.js";
import type { IngestDoc } from "../src/ingest/run.js";

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function fakeBridge(
  files: IngestScanResult["files"],
  contents: Record<string, string>,
  opts: { offline?: boolean } = {},
): { call: BridgeCall; calls: string[] } {
  const calls: string[] = [];
  const call: BridgeCall = async (method, params) => {
    calls.push(method);
    if (opts.offline === true) throw new Error("runtime unavailable: macbook");
    if (method === "ingest.scan") {
      const since = (params as { since?: string }).since;
      const kept = since === undefined ? files : files.filter((f) => f.mtime > since);
      return { files: kept, truncated: false } satisfies IngestScanResult;
    }
    const path = (params as { path: string }).path;
    const body = contents[path] ?? "";
    return {
      path,
      mtime: files.find((f) => f.path === path)?.mtime ?? "2026-09-20T00:00:00.000Z",
      bytes: Buffer.byteLength(body),
      content_b64: Buffer.from(body, "utf8").toString("base64"),
      truncated: false,
    } satisfies IngestReadResult;
  };
  return { call, calls };
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) out.push(d);
  return out;
}

const FILES: IngestScanResult["files"] = [
  {
    path: "/Users/logan/notes/a.md",
    size: 10,
    mtime: "2026-09-19T00:00:00.000Z",
    sha256: "a".repeat(64),
  },
  {
    path: "/Users/logan/notes/b.md",
    size: 12,
    mtime: "2026-09-20T00:00:00.000Z",
    sha256: "b".repeat(64),
  },
];

describe("createLocalMacbookProvider", () => {
  it("scans then reads each file and yields one doc per file", async () => {
    const { call, calls } = fakeBridge(FILES, {
      "/Users/logan/notes/a.md": "본문 A",
      "/Users/logan/notes/b.md": "본문 B",
    });
    const p = createLocalMacbookProvider({ roots: ["/Users/logan/notes"], call });
    expect(p.kind).toBe("file");
    expect(p.ref).toBe("macbook");

    const docs = await collect(p.list({ pool: {} as never, logger, cursor: {} }));
    expect(docs.map((d) => d.source_ref)).toEqual(FILES.map((f) => f.path));
    expect(docs[0]?.text).toBe("본문 A");
    expect(docs[0]?.validFrom).toBe("2026-09-19T00:00:00.000Z");
    expect(docs[0]?.meta?.host).toBe("macbook");
    expect(calls).toEqual(["ingest.scan", "ingest.read", "ingest.read"]);
  });

  it("advances the cursor to the newest mtime it saw", async () => {
    const { call } = fakeBridge(FILES, {
      "/Users/logan/notes/a.md": "A",
      "/Users/logan/notes/b.md": "B",
    });
    const p = createLocalMacbookProvider({ roots: ["/Users/logan/notes"], call });
    const docs = await collect(p.list({ pool: {} as never, logger, cursor: {} }));
    expect(docs[docs.length - 1]?.nextCursor).toEqual({ since: "2026-09-20T00:00:00.000Z" });
  });

  it("passes since so an offline gap is caught up on the next tick", async () => {
    const { call } = fakeBridge(FILES, { "/Users/logan/notes/b.md": "B" });
    const p = createLocalMacbookProvider({ roots: ["/Users/logan/notes"], call });
    const docs = await collect(
      p.list({ pool: {} as never, logger, cursor: { since: "2026-09-19T12:00:00.000Z" } }),
    );
    expect(docs.map((d) => d.source_ref)).toEqual(["/Users/logan/notes/b.md"]);
  });

  // A4 §10.1: 브리지가 오프라인이면 건너뛴다 — 실패로 카운트해 dead-letter를 부르지 않는다.
  it("yields nothing and does not throw when the bridge is offline", async () => {
    const { call } = fakeBridge(FILES, {}, { offline: true });
    const p = createLocalMacbookProvider({ roots: ["/Users/logan/notes"], call });
    expect(await collect(p.list({ pool: {} as never, logger, cursor: {} }))).toEqual([]);
  });

  it("skips a single unreadable file but keeps going", async () => {
    let n = 0;
    const call: BridgeCall = async (method, params) => {
      if (method === "ingest.scan")
        return { files: FILES, truncated: false } satisfies IngestScanResult;
      n += 1;
      if (n === 1) throw new Error("path is not readable");
      return {
        path: (params as { path: string }).path,
        mtime: "2026-09-20T00:00:00.000Z",
        bytes: 1,
        content_b64: Buffer.from("B", "utf8").toString("base64"),
        truncated: false,
      } satisfies IngestReadResult;
    };
    const p = createLocalMacbookProvider({ roots: ["/Users/logan/notes"], call });
    const docs = await collect(p.list({ pool: {} as never, logger, cursor: {} }));
    expect(docs.map((d) => d.source_ref)).toEqual(["/Users/logan/notes/b.md"]);
  });

  it("does not call the bridge at all when no root is configured", async () => {
    const { call, calls } = fakeBridge(FILES, {});
    const p = createLocalMacbookProvider({ roots: [], call });
    expect(await collect(p.list({ pool: {} as never, logger, cursor: {} }))).toEqual([]);
    expect(calls).toEqual([]);
  });
});
