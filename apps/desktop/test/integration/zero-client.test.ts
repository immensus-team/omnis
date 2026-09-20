// 이 테스트는 살아 있는 zero-cache(127.0.0.1:4848)를 탄다 — 기동 절차는 ops/zero-cache.env.example의
// "테스트용 1회성 기동"이다(끝나면 replication slot을 손으로 지운다). 서비스가 필요하므로 unit이 아니라
// integration 프로젝트에 둔다: CI의 `pnpm test -- --project unit --project contract`는 이걸 수집하지 않는다.
import { afterAll, describe, expect, it } from "vitest";
import { initZero } from "../../src/zero-client";

describe("US-A22 Zero read-only round trip", () => {
  const zero = initZero({ userID: "logan-test" });

  it("resolves a query against threads without throwing (A3 §7 복제 대상)", async () => {
    // {type:"complete"}가 핵심이다. 기본값 {type:"unknown"}은 서버를 건드리지 않고 비어 있는
    // 로컬 클라이언트 스토어에서 바로 resolve해서, zero-cache가 죽어 있어도 통과한다.
    const rows = await zero.query.threads.limit(1).run({ type: "complete" });
    expect(Array.isArray(rows)).toBe(true);
  }, 10_000);

  afterAll(async () => {
    await zero.close();
  });
});
