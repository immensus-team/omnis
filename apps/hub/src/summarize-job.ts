import type { Events, Logger } from "@omnis/kernel";

/** B3: 새 durable inbound item → 스레드 단위 30초 디바운스 → summarizeThread.
 *  omnis_item은 items 테이블의 AFTER INSERT OR UPDATE 트리거(0007_notify.sql)가 매 row마다
 *  쏜다 — op:'insert'만 트리거로 삼는다(update는 요약을 다시 돌 이유가 아니다).
 *  ponytail: 고정 지연 디바운스(첫 이벤트가 타이머를 걸고, 창이 열려 있는 동안 온 이벤트는
 *  버린다) — 슬라이딩이 아니다. 연달아 오는 스레드는 30초마다 한 번씩 돈다. summarizeThread가
 *  매번 최신 마지막 item을 다시 읽으므로 정확도엔 문제없다. 창을 계속 미루는 슬라이딩이
 *  필요해지면(끊임없이 채팅하는 스레드가 영영 요약을 못 받는 게 문제가 되면) 그때 바꾼다. */
export function registerSummaryJob(deps: {
  events: Events;
  logger: Logger;
  summarizeThread: (threadId: string) => Promise<unknown>;
  debounceMs?: number;
}): () => void {
  const { events, logger, summarizeThread, debounceMs = 30_000 } = deps;
  const pending = new Set<string>();

  return events.subscribe("omnis_item", (payload) => {
    if (payload.op !== "insert") return;
    const threadId = payload.thread_id;
    if (typeof threadId !== "string" || pending.has(threadId)) return;
    pending.add(threadId);
    setTimeout(() => {
      pending.delete(threadId);
      summarizeThread(threadId).catch((e: unknown) => {
        logger.error("summarizeThread failed", {
          threadId,
          err: e instanceof Error ? e.message : String(e),
        });
      });
    }, debounceMs).unref();
  });
}
