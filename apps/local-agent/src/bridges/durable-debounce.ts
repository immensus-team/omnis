import type { BridgeMethod } from "@omnis/protocol";

export interface DurableEvent {
  method: BridgeMethod;
  params: Record<string, unknown>;
}

/**
 * A2-D4: a row is created on turn.item.started; UPDATEs happen only on the 500ms debounce or on turn.item.completed.
 * Duplicate started events for the same item_id are dropped, and a burst of completed events keeps only the last.
 */
export function createDurableDebouncer(
  emit: (e: DurableEvent) => void,
  opts: { intervalMs?: number } = {},
): { push(e: DurableEvent): void; flush(): void } {
  const intervalMs = opts.intervalMs ?? 500;
  const started = new Set<string>();
  const held = new Map<string, DurableEvent>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    for (const e of held.values()) emit(e);
    held.clear();
  };

  const arm = (): void => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, intervalMs);
  };

  return {
    push(e: DurableEvent): void {
      const itemId = String(e.params.item_id ?? "");
      if (e.method === "turn.item.started") {
        if (started.has(itemId)) return;
        started.add(itemId);
        emit(e);
        return;
      }
      if (e.method === "turn.item.completed") {
        held.set(itemId, e);
        arm();
        return;
      }
      flush();
      emit(e);
    },
    flush,
  };
}
