// The definition lives in @omnis/protocol (because the hub and the bridge must use the same list — A2 §3.2).
// The @omnis/memory export that delta §3 requires is satisfied here with a re-export.
export {
  DENY_PATTERNS,
  MAX_INGEST_FILE_BYTES,
  gitignoreMatcher,
  isBinary,
  isDenied,
} from "@omnis/protocol";

export class IngestDeniedError extends Error {
  constructor(readonly path: string) {
    super(`path is on the A4 §10.2 hard deny list: ${path}`);
    this.name = "IngestDeniedError";
  }
}
