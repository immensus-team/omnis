// A4 §10.1 local files (mini): FSEvents real-time + one rescan at boot. The allowlist is injected
// (@omnis/memory cannot call @omnis/kernel's getSetting — the hub reads it and plugs it in).
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

/** ponytail: reads only one .gitignore per root. Nested .gitignore files are ignored — erring toward
 *  over-exclusion rather than over-inclusion is the safe direction for this loop. */
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
        continue; // no permission or gone — skip silently
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
          // A4 §10.4 table: if the document does not state a time, the file mtime is valid_from.
          validFrom: f.mtime,
          meta: { host: "mini", size: f.size },
          nextCursor: { since: newest },
        };
      }
    },
  };
}

/** A4 §10.1: FSEvents. macOS's fs.watch(recursive) uses FSEvents directly — no separate package.
 *  A change notification is only a hint to "re-read this path"; the actual read is done by the provider. */
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
