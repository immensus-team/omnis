// A4 §10.1 로컬 파일(미니): FSEvents 실시간 + 부팅 시 1회 재스캔. allowlist는 주입된다
// (@omnis/memory는 @omnis/kernel의 getSetting을 부를 수 없다 — 허브가 읽어서 꽂는다).
import { type FSWatcher, watch } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MAX_INGEST_FILE_BYTES, gitignoreMatcher, isBinary, isDenied } from "./deny.js";
import type { IngestDoc, IngestProvider, Logger } from "./run.js";

export interface LocalFile {
  path: string;
  size: number;
  mtime: string;
}

export interface ScanOptions {
  since?: string;
  maxFiles?: number;
}

/** ponytail: 루트당 .gitignore 하나만 읽는다. 중첩 .gitignore는 무시 — 과다 포함이 아니라
 *  과다 제외 쪽으로 틀리는 게 이 루프에서는 안전하다. */
async function ignoreFor(root: string): Promise<(path: string) => boolean> {
  try {
    return gitignoreMatcher(root, await readFile(join(root, ".gitignore"), "utf8"));
  } catch {
    return () => false;
  }
}

export async function scanRoots(
  roots: readonly string[],
  opts: ScanOptions = {},
): Promise<LocalFile[]> {
  const sinceMs = opts.since === undefined ? 0 : Date.parse(opts.since);
  const maxFiles = opts.maxFiles ?? 20_000;
  const out: LocalFile[] = [];

  for (const rawRoot of roots) {
    const root = resolve(rawRoot);
    const ignored = await ignoreFor(root);
    const stack: string[] = [root];
    while (stack.length > 0 && out.length < maxFiles) {
      const dir = stack.pop() as string;
      let entries: Awaited<ReturnType<typeof readdir>>;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue; // 권한 없음·사라짐 — 조용히 건너뛴다
      }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        // .gitignore is exclusion metadata, not ingestable content.
        if (entry.name === ".gitignore" || isDenied(path) || ignored(path)) continue;
        if (entry.isDirectory()) {
          stack.push(path);
          continue;
        }
        if (!entry.isFile()) continue;
        let info: Awaited<ReturnType<typeof stat>>;
        try {
          info = await stat(path);
        } catch {
          continue;
        }
        if (info.size > MAX_INGEST_FILE_BYTES) continue;
        if (info.mtimeMs <= sinceMs) continue;
        try {
          const head = await readFile(path);
          if (isBinary(head)) continue;
        } catch {
          continue;
        }
        out.push({ path, size: info.size, mtime: new Date(info.mtimeMs).toISOString() });
        if (out.length >= maxFiles) break;
      }
    }
  }
  return out;
}

export function createLocalMiniProvider(opts: { roots: readonly string[] }): IngestProvider {
  return {
    kind: "file",
    ref: "mini",
    async *list(ctx): AsyncIterable<IngestDoc> {
      const since = typeof ctx.cursor.since === "string" ? ctx.cursor.since : undefined;
      const files = await scanRoots(opts.roots, since === undefined ? {} : { since });
      let newest = since ?? "1970-01-01T00:00:00.000Z";
      for (const f of files) {
        let text: string;
        try {
          text = await readFile(f.path, "utf8");
        } catch {
          continue;
        }
        if (f.mtime > newest) newest = f.mtime;
        yield {
          source_ref: f.path,
          text,
          // A4 §10.4 표: 문서가 시점을 말하지 않으면 파일 mtime이 valid_from이다.
          validFrom: f.mtime,
          meta: { host: "mini", size: f.size },
          nextCursor: { since: newest },
        };
      }
    },
  };
}

/** A4 §10.1: FSEvents. macOS의 fs.watch(recursive)가 그대로 FSEvents를 쓴다 — 별도 패키지 없음.
 *  변경 통지는 "이 경로를 다시 읽어라"는 힌트일 뿐이고, 실제 읽기는 provider가 한다. */
export function watchLocalRoots(opts: {
  roots: readonly string[];
  logger: Logger;
  onChange: (path: string) => void;
}): () => void {
  const watchers: FSWatcher[] = [];
  for (const rawRoot of opts.roots) {
    const root = resolve(rawRoot);
    try {
      const w = watch(root, { recursive: true }, (_event, filename) => {
        if (filename === null) return;
        const path = join(root, filename.toString());
        if (isDenied(path)) return;
        opts.onChange(path);
      });
      w.on("error", (e) => {
        opts.logger.warn("fs watch error", { root, err: e.message });
      });
      watchers.push(w);
    } catch (e) {
      opts.logger.warn("fs watch failed", {
        root,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return (): void => {
    for (const w of watchers) w.close();
  };
}
