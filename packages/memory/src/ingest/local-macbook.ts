// A4 §10.1 로컬 파일(맥북): 허브가 A2 §3.2 ingest.scan → ingest.read로 가져온다.
// drive_poll 틱(10분)에 동승하고, 브리지가 오프라인이면 건너뛰고 다음 틱에 since로 따라잡는다.
import type { IngestReadResult, IngestScanResult } from "@omnis/protocol";
import type { IngestDoc, IngestProvider } from "./run.js";

/** apps/hub의 `BridgeHub.call(host, method, params)`를 맥북 호스트에 고정한 얇은 함수. */
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
      if (opts.roots.length === 0) return; // allowlist가 비어 있으면 브리지를 부르지도 않는다

      const since = typeof ctx.cursor.since === "string" ? ctx.cursor.since : undefined;
      let scan: IngestScanResult;
      try {
        scan = (await opts.call("ingest.scan", {
          roots: [...opts.roots],
          ...(since === undefined ? {} : { since }),
        })) as IngestScanResult;
      } catch (e) {
        // 오프라인은 실패가 아니다 — 커서를 그대로 두고 다음 틱이 따라잡는다.
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
          // 한 파일이 거부돼도(비밀 목록·바이너리·사라짐) 나머지는 계속 가져온다.
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
