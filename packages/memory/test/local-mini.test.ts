import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_INGEST_FILE_BYTES } from "../src/ingest/deny.js";
import { createLocalMiniProvider, scanRoots, watchLocalRoots } from "../src/ingest/local-mini.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "omnis-local-"));
});

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("scanRoots", () => {
  it("returns nothing when the allowlist is empty (A4 §10.1 기본값)", async () => {
    expect(await scanRoots([])).toEqual([]);
  });

  it("walks subdirectories and returns absolute paths with mtime and size", async () => {
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "a.md"), "메모 A");
    await writeFile(join(root, "b.md"), "메모 B");

    const files = await scanRoots([root]);
    expect(files.map((f) => f.path).sort()).toEqual(
      [join(root, "b.md"), join(root, "notes", "a.md")].sort(),
    );
    expect(files[0]?.size).toBeGreaterThan(0);
    expect(files[0]?.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("never opens a denied path", async () => {
    await writeFile(join(root, ".env"), "SECRET=1");
    await writeFile(join(root, "ok.md"), "괜찮음");
    const files = await scanRoots([root]);
    expect(files.map((f) => f.path)).toEqual([join(root, "ok.md")]);
  });

  it("skips files over the 2MB cap", async () => {
    await writeFile(join(root, "big.md"), "가".repeat(MAX_INGEST_FILE_BYTES));
    await writeFile(join(root, "small.md"), "작다");
    const files = await scanRoots([root]);
    expect(files.map((f) => f.path)).toEqual([join(root, "small.md")]);
  });

  it("skips binaries detected by a NUL byte in the first 8KB", async () => {
    await writeFile(
      join(root, "blob.dat"),
      Buffer.concat([Buffer.from("AB"), Buffer.from([0]), Buffer.from("CD")]),
    );
    await writeFile(join(root, "text.md"), "텍스트");
    const files = await scanRoots([root]);
    expect(files.map((f) => f.path)).toEqual([join(root, "text.md")]);
  });

  it("merges .gitignore patterns into the exclusion set", async () => {
    await writeFile(join(root, ".gitignore"), "dist/\n*.log\n");
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "bundle.js"), "빌드 산출물");
    await writeFile(join(root, "app.log"), "로그");
    await writeFile(join(root, "src.md"), "소스");

    const files = await scanRoots([root]);
    expect(files.map((f) => f.path)).toEqual([join(root, "src.md")]);
  });

  it("filters by mtime when since is given", async () => {
    await writeFile(join(root, "old.md"), "옛것");
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(await scanRoots([root], { since: future })).toEqual([]);
  });

  it("ignores a root that does not exist instead of throwing", async () => {
    expect(await scanRoots([join(root, "nope")])).toEqual([]);
  });
});

describe("createLocalMiniProvider", () => {
  it("yields one doc per file with the file content and mtime as validFrom", async () => {
    await writeFile(join(root, "a.md"), "본문 A");
    const p = createLocalMiniProvider({ roots: [root] });
    expect(p.kind).toBe("file");

    const docs = [];
    for await (const d of p.list({ pool: {} as never, logger, cursor: {} })) docs.push(d);

    expect(docs).toHaveLength(1);
    expect(docs[0]?.source_ref).toBe(join(root, "a.md"));
    expect(docs[0]?.text).toBe("본문 A");
    expect(docs[0]?.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(docs[0]?.nextCursor?.since).toBeDefined();
  });

  it("uses the cursor's since on the next run", async () => {
    await writeFile(join(root, "a.md"), "본문 A");
    const p = createLocalMiniProvider({ roots: [root] });
    const future = new Date(Date.now() + 60_000).toISOString();
    const docs = [];
    for await (const d of p.list({ pool: {} as never, logger, cursor: { since: future } }))
      docs.push(d);
    expect(docs).toEqual([]);
  });

  it("yields nothing at all when no root is configured", async () => {
    const p = createLocalMiniProvider({ roots: [] });
    const docs = [];
    for await (const d of p.list({ pool: {} as never, logger, cursor: {} })) docs.push(d);
    expect(docs).toEqual([]);
  });
});

/** macOS의 fs.watch(recursive)는 FSEvents 스트림을 비동기로 무장하고, 스트림 시작 이전의
 *  이벤트는 재생하지 않는다. 한 번만 쓰면 그 쓰기가 통째로 유실될 수 있으므로 워처가
 *  보고할 때까지 다시 쓴다. */
async function writeUntilSeen(path: string, body: string, seen: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!seen() && Date.now() < deadline) {
    await writeFile(path, body);
    for (let i = 0; i < 10 && !seen(); i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

describe("watchLocalRoots", () => {
  it("reports a changed file and stops reporting after the returned unsubscribe", async () => {
    const seen: string[] = [];
    const stop = watchLocalRoots({ roots: [root], logger, onChange: (p) => seen.push(p) });
    try {
      const sawWatched = (): boolean => seen.some((p) => p.endsWith("watched.md"));
      await writeUntilSeen(join(root, "watched.md"), "새 파일", sawWatched);
      expect(sawWatched()).toBe(true);
    } finally {
      stop();
    }
    const before = seen.length;
    await writeFile(join(root, "after-stop.md"), "무시되어야 함");
    await new Promise((r) => setTimeout(r, 300));
    expect(seen.length).toBe(before);
  });

  it("never reports a denied path", async () => {
    const seen: string[] = [];
    const stop = watchLocalRoots({ roots: [root], logger, onChange: (p) => seen.push(p) });
    try {
      // 워처가 실제로 무장한 뒤에 .env를 쓴다 — 그러지 않으면 이 테스트는 공허하게 통과한다.
      const sawOk = (): boolean => seen.some((p) => p.endsWith("ok.md"));
      await writeUntilSeen(join(root, "ok.md"), "괜찮음", sawOk);
      expect(sawOk()).toBe(true);

      await writeFile(join(root, ".env"), "SECRET=1");
      await new Promise((r) => setTimeout(r, 500));
      expect(seen.filter((p) => p.endsWith(".env"))).toEqual([]);
    } finally {
      stop();
    }
  });

  it("returns a no-op unsubscribe for an empty allowlist", () => {
    const stop = watchLocalRoots({ roots: [], logger, onChange: () => undefined });
    expect(() => stop()).not.toThrow();
  });
});
