// A4 §10.1 local files (MacBook): the hub fetches them via A2 §3.2 ingest.scan → ingest.read.
// Rides along on the drive_poll tick (10 minutes); if the bridge is offline, skip and catch up with since on the next tick.
import type { IngestReadResult, IngestScanResult } from "@omnis/protocol";
import type { IngestDoc, IngestProvider } from "./run.js";

/** A thin function that pins apps/hub's `BridgeHub.call(host, method, params)` to the MacBook host. */
export type BridgeCall = (
  method: "ingest.scan" | "ingest.read",
  params: Record<string, unknown>,
) => Promise<unknown>;

export function createLocalMacbookProvider(opts: {
  roots: readonly string[];
  call: BridgeCall;
}): IngestProvider {
  return {
    kind: "file",
    ref: "macbook",
    async *list(ctx): AsyncIterable<IngestDoc> {
      if (opts.roots.length === 0) return; // when the allowlist is empty, do not even call the bridge

      const since = typeof ctx.cursor.since === "string" ? ctx.cursor.since : undefined;
      let scan: IngestScanResult;
      try {
        scan = (await opts.call("ingest.scan", {
          roots: [...opts.roots],
          ...(since === undefined ? {} : { since }),
        })) as IngestScanResult;
      } catch (e) {
        // Offline is not a failure — leave the cursor as it is and the next tick catches up.
        ctx.logger.info("macbook bridge offline, skipping ingest tick", {
          err: e instanceof Error ? e.message : String(e),
        });
        return;
      }
      if (scan.truncated) {
        ctx.logger.warn("ingest.scan truncated — next tick continues from the cursor", {
          files: scan.files.length,
        });
      }

      let newest = since ?? "1970-01-01T00:00:00.000Z";
      for (const f of scan.files) {
        let read: IngestReadResult;
        try {
          read = (await opts.call("ingest.read", {
            path: f.path,
            max_bytes: 1_048_576,
          })) as IngestReadResult;
        } catch (e) {
          // One rejected file (secret list, binary, vanished) does not stop the rest.
          ctx.logger.debug("ingest.read skipped", {
            source_ref: f.path,
            err: e instanceof Error ? e.message : String(e),
          });
          continue;
        }
        if (f.mtime > newest) newest = f.mtime;
        yield {
          source_ref: f.path,
          text: Buffer.from(read.content_b64, "base64").toString("utf8"),
          validFrom: f.mtime,
          meta: { host: "macbook", size: f.size, sha256: f.sha256, truncated: read.truncated },
          nextCursor: { since: newest },
        };
      }
    },
  };
}
