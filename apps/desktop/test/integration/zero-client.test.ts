// 이 테스트는 살아 있는 zero-cache를 탄다 — 서비스가 없으면 통과할 방법이 없으므로 서비스 주소가
// 주어졌을 때만 돈다. CI(그리고 zero-cache를 안 띄운 로컬)에서는 skip이다: 삭제·비활성화가 아니라
// "의존 서비스가 있을 때만 수집"이다.
//
// 재현:
//   1) ops/zero-cache.env.example의 "테스트용 1회성 기동"으로 zero-cache를 띄운다.
//   2) OMNIS_ZERO_URL=http://127.0.0.1:4848 pnpm test:integration
//   3) 끝나면 replication slot을 손으로 지운다(같은 파일의 pg_drop_replication_slot 줄).
import { describe, expect, it } from "vitest";
import { initZero } from "../../src/zero-client";

const zeroCacheUrl = process.env.OMNIS_ZERO_URL;

describe.skipIf(!zeroCacheUrl)("US-A22 Zero read-only round trip", () => {
  // skip된 suite도 collection 때 이 콜백은 실행된다 — 클라이언트 생성(=WebSocket 열기)을
  // it 안으로 미뤄야 skip일 때 소켓이 안 열린다.
  it("resolves a query against threads without throwing (A3 §7 복제 대상)", async () => {
    const zero = initZero({ server: zeroCacheUrl, userID: "logan-test" });
    try {
      // {type:"complete"}가 핵심이다. 기본값 {type:"unknown"}은 서버를 건드리지 않고 비어 있는
      // 로컬 클라이언트 스토어에서 바로 resolve해서, zero-cache가 죽어 있어도 통과한다.
      const rows = await zero.query.threads.limit(1).run({ type: "complete" });
      expect(Array.isArray(rows)).toBe(true);
    } finally {
      await zero.close();
    }
  }, 10_000);
});
