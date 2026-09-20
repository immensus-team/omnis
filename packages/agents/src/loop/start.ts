// A4 §1.2. 레지스트리의 루프를 커널 이벤트·스케줄러에 붙인다.
// @omnis/agents는 @omnis/kernel을 의존하지 않는다(계약 §1). Kernel/Logger가 구조적으로
// 대입되는 최소 인터페이스만 여기 둔다 — 허브가 createKernel()의 결과를 그대로 넘긴다.
import { listLoops } from "./registry.js";
import { runLoopSpec } from "./run.js";
import type { LoopId, TriggerContext } from "./spec.js";

export interface LoopKernel {
  events: {
    subscribe(channel: string, fn: (p: Record<string, unknown>) => void): () => void;
  };
  scheduler: {
    register(name: string, cron: string, handler: () => Promise<void>): void;
  };
}

export interface LoopLogger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

/** schedule 트리거를 쓰는 루프의 jobs.name. 이름은 0006_kernel.sql의 seed와 1:1이다. */
export const LOOP_JOB_NAME: Partial<Record<LoopId, string>> = {
  auto_archive: "auto_archive_sweep",
  followup: "network_inactive_sweep",
  task: "task_remind",
  ingest: "drive_poll",
};

function str(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" ? v : undefined;
}

function ctxFrom(payload: Record<string, unknown>, now: Date): TriggerContext {
  const itemId = str(payload, "item_id") ?? str(payload, "id");
  const threadId = str(payload, "thread_id");
  const taskId = str(payload, "task_id");
  const noteId = str(payload, "note_id");
  return {
    trigger_kind: "event",
    now,
    payload,
    ...(itemId !== undefined ? { item_id: itemId } : {}),
    ...(threadId !== undefined ? { thread_id: threadId } : {}),
    ...(taskId !== undefined ? { task_id: taskId } : {}),
    ...(noteId !== undefined ? { note_id: noteId } : {}),
  };
}

export function startLoops(deps: { kernel: LoopKernel; logger: LoopLogger }): () => void {
  const { kernel, logger } = deps;
  const stops: (() => void)[] = [];
  const timers = new Set<NodeJS.Timeout>();

  const fail = (loop: LoopId) => (e: unknown) => {
    logger.error("loop failed", { loop, err: e instanceof Error ? e.message : String(e) });
  };

  for (const spec of listLoops()) {
    const { trigger } = spec;
    if (trigger.kind === "schedule" && trigger.cron !== undefined) {
      const name = LOOP_JOB_NAME[spec.id] ?? `${spec.id}_job`;
      kernel.scheduler.register(name, trigger.cron, async () => {
        await runLoopSpec(spec, {
          trigger_kind: "cron",
          trigger_ref: name,
          now: new Date(),
          payload: {},
        });
      });
      continue;
    }
    if (trigger.kind !== "event" || trigger.on === undefined) continue;

    // ponytail: 고정 지연 디바운스 — 첫 이벤트가 타이머를 걸고, 창이 열린 동안 온 같은 키는
    // 버린다(apps/hub/src/summarize-job.ts와 같은 형태). 슬라이딩이 필요해지면 그때 바꾼다.
    const pending = new Set<string>();
    const debounceMs = trigger.debounceMs ?? 0;
    stops.push(
      kernel.events.subscribe(trigger.on, (payload) => {
        const key = `${spec.id}:${String(payload.thread_id ?? payload.id ?? "")}`;
        if (pending.has(key)) return;
        pending.add(key);
        const t = setTimeout(() => {
          pending.delete(key);
          timers.delete(t);
          runLoopSpec(spec, ctxFrom(payload, new Date())).catch(fail(spec.id));
        }, debounceMs);
        t.unref();
        timers.add(t);
      }),
    );
  }

  return () => {
    for (const s of stops) s();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
