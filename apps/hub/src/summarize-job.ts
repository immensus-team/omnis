import type { Events, Logger } from "@omnis/kernel";

/** B3: new durable inbound item → per-thread 30-second debounce → summarizeThread.
 *  omnis_item is fired per row by the AFTER INSERT OR UPDATE trigger on the items table
 *  (0007_notify.sql) — only op:'insert' counts as a trigger (an update is no reason to re-run the
 *  summary).
 *  ponytail: fixed-delay debounce (the first event arms the timer; events arriving while the
 *  window is open are dropped) — not sliding. Threads that keep firing run once every 30 seconds.
 *  That costs nothing in accuracy because summarizeThread re-reads the latest last item each time.
 *  Switch to a sliding window that keeps pushing the deadline if that becomes necessary (i.e. if
 *  a constantly-chatting thread never getting a summary turns into a real problem). */
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
