// 정의는 @omnis/protocol에 있다(허브와 브리지가 같은 목록을 써야 하기 때문 — A2 §3.2).
// 델타 §3이 요구하는 @omnis/memory export는 여기서 re-export로 만족시킨다.
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
