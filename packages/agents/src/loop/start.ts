// A4 §1.2. Attaches the registry's loops to kernel events and the scheduler.
// @omnis/agents does not depend on @omnis/kernel (contract §1). Only the minimal interfaces
// that Kernel/Logger structurally satisfy live here — the hub passes createKernel()'s result straight in.
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

/** jobs.name for loops that use a schedule trigger. The names are 1:1 with the seed in 0006_kernel.sql. */
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

    // ponytail: fixed-delay debounce — the first event arms the timer, and same-key events arriving
    // while the window is open are dropped (same shape as apps/hub/src/summarize-job.ts). Switch to
    // sliding when that need actually shows up.
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
