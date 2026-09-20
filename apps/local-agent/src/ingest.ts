// A2 §3.2: the bridge re-cuts the roots/path the hub sent. Three bounds —
// ① allowlist ∩ allowed_roots intersection + realpath re-check, ② secret files always rejected, ③ 1MB truncation.
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  BRIDGE_ERRORS,
  BridgeError,
  type IngestReadParams,
  type IngestReadResult,
  type IngestScanParams,
  type IngestScanResult,
  MAX_INGEST_FILE_BYTES,
  isBinary,
  isDenied,
} from "@omnis/protocol";
import type { Logger } from "./logger.js";
import { assertPathAllowed } from "./paths.js";

export const INGEST_SCAN_MAX_FILES = 5000;

export interface IngestDeps {
  allowedRoots: string[];
  logger: Logger;
  maxFiles?: number;
  /** An unauthorized root is dropped silently instead of raising (the hub sends several hosts' roots at once). */
  skipDisallowedRoots?: boolean;
}

export async function handleIngestScan(
  params: IngestScanParams,
  deps: IngestDeps,
): Promise<IngestScanResult> {
  const maxFiles = deps.maxFiles ?? INGEST_SCAN_MAX_FILES;
  const sinceMs = params.since === undefined ? 0 : Date.parse(params.since);
  const files: IngestScanResult["files"] = [];
  let truncated = false;

  for (const rawRoot of params.roots) {
    let root: string;
    try {
      root = assertPathAllowed(rawRoot, deps.allowedRoots); // includes the realpath re-check
    } catch (e) {
      if (deps.skipDisallowedRoots === true) {
        deps.logger.warn("ingest.scan root skipped", { root: rawRoot });
        continue;
      }
      throw e;
    }

    const stack: string[] = [root];
    while (stack.length > 0) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      const dir = stack.pop() as string;
      let entries: Awaited<ReturnType<typeof readdir>>;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (files.length >= maxFiles) {
          truncated = true;
          break;
        }
        const path = join(dir, entry.name);
        if (isDenied(path)) continue; // bound ②
        if (entry.isDirectory()) {
          stack.push(path);
          continue;
        }
        if (!entry.isFile()) continue;
        let info: Awaited<ReturnType<typeof stat>>;
        let buf: Buffer;
        try {
          info = await stat(path);
          if (info.size > MAX_INGEST_FILE_BYTES) continue;
          if (info.mtimeMs <= sinceMs) continue;
          buf = await readFile(path);
        } catch {
          continue;
        }
        if (isBinary(buf)) continue;
        files.push({
          path,
          size: info.size,
          mtime: new Date(info.mtimeMs).toISOString(),
          sha256: createHash("sha256").update(buf).digest("hex"),
        });
      }
    }
  }

  return { files, truncated };
}

export async function handleIngestRead(
  params: IngestReadParams,
  deps: IngestDeps,
): Promise<IngestReadResult> {
  const path = assertPathAllowed(params.path, deps.allowedRoots); // bound ①
  if (isDenied(path)) {
    // The rejection reason is not stated specifically — which path hits the secret list is itself information.
    throw new BridgeError(BRIDGE_ERRORS.PATH_NOT_ALLOWED, "path is not readable", {
      path: params.path,
    });
  }

  let info: Awaited<ReturnType<typeof stat>>;
  let buf: Buffer;
  try {
    info = await stat(path);
    buf = await readFile(path);
  } catch {
    throw new BridgeError(BRIDGE_ERRORS.PATH_NOT_ALLOWED, "path is not readable", {
      path: params.path,
    });
  }
  if (isBinary(buf)) {
    throw new BridgeError(BRIDGE_ERRORS.PATH_NOT_ALLOWED, "path is not readable", {
      path: params.path,
    });
  }

  const limit = Math.min(params.max_bytes, MAX_INGEST_FILE_BYTES); // bound ③
  const slice = buf.subarray(0, limit);
  return {
    path,
    mtime: new Date(info.mtimeMs).toISOString(),
    bytes: slice.length,
    content_b64: slice.toString("base64"),
    truncated: slice.length < buf.length,
  };
}
