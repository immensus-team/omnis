import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registerLoop, resetLoopRegistryForTest } from "../src/loop/registry.js";
import type { LoopSpec, TriggerContext } from "../src/loop/spec.js";
import { LOOP_JOB_NAME, startLoops } from "../src/loop/start.js";

// runLoopSpec needs the DB (agent_runs) — this unit test only checks the wiring, so the executor is stubbed.
const mocks = vi.hoisted(() => ({ runLoopSpec: vi.fn() }));
vi.mock("../src/loop/run.js", () => ({ runLoopSpec: mocks.runLoopSpec }));

function fakeKernel() {
  const subs = new Map<string, (p: Record<string, unknown>) => void>();
  const jobs = new Map<string, { cron: string; handler: () => Promise<void> }>();
  return {
    jobs,
    emit(kind: string, payload: Record<string, unknown>): void {
      subs.get(kind)?.(payload);
    },
    kernel: {
      events: {
        subscribe(channel: string, fn: (p: Record<string, unknown>) => void): () => void {
          subs.set(channel, fn);
          return () => void subs.delete(channel);
        },
      },
      scheduler: {
        register(name: string, cron: string, handler: () => Promise<void>): void {
          jobs.set(name, { cron, handler });
        },
      },
    },
  };
}

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function eventSpec(over: Partial<LoopSpec<{ ok: boolean }>> = {}): LoopSpec<{ ok: boolean }> {
  return {
    id: "note_route",
    kind: "reactive",
    trigger: { kind: "event", on: "note.created", debounceMs: 10 },
    palette: [],
    budget: { inputTokens: 10, outputTokens: 10, wallClockMs: 10, maxSteps: 1 },
    tier: "T1",
    outputSchema: z.object({ ok: z.boolean() }),
    assemble: async () => ({
      cachedPrefix: "",
      volatile: [],
      tokenEstimate: 0,
      truncated: false,
      provenance: [],
    }),
    apply: async () => undefined,
    ...over,
  };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

describe("startLoops (A4 §1.2)", () => {
  beforeEach(() => {
    resetLoopRegistryForTest();
    mocks.runLoopSpec.mockReset();
    mocks.runLoopSpec.mockResolvedValue(undefined);
  });

  it("debounces an event trigger and runs the loop once with a mapped context", async () => {
    registerLoop(eventSpec());
    const f = fakeKernel();
    const stop = startLoops({ kernel: f.kernel, logger });
    f.emit("note.created", { id: "n1", thread_id: "t1" });
    f.emit("note.created", { id: "n1", thread_id: "t1" });
    await settle();
    expect(mocks.runLoopSpec).toHaveBeenCalledTimes(1);
    const ctx = mocks.runLoopSpec.mock.calls[0]?.[1] as TriggerContext;
    expect(ctx.trigger_kind).toBe("event");
    expect(ctx.item_id).toBe("n1");
    expect(ctx.thread_id).toBe("t1");
    stop();
  });

  it("keeps a loop failure from escaping into the event emitter", async () => {
    registerLoop(eventSpec());
    mocks.runLoopSpec.mockRejectedValue(new Error("boom"));
    const errors: string[] = [];
    const f = fakeKernel();
    const stop = startLoops({
      kernel: f.kernel,
      logger: { ...logger, error: (msg: string) => errors.push(msg) },
    });
    f.emit("note.created", { id: "n1" });
    await settle();
    expect(errors).toEqual(["loop failed"]);
    stop();
  });

  it("registers a schedule trigger as the seeded cron job name", async () => {
    registerLoop(
      eventSpec({ id: "auto_archive", trigger: { kind: "schedule", cron: "0 22 * * *" } }),
    );
    const f = fakeKernel();
    const stop = startLoops({ kernel: f.kernel, logger });
    const job = f.jobs.get(LOOP_JOB_NAME.auto_archive ?? "");
    expect(job?.cron).toBe("0 22 * * *");
    await job?.handler();
    const ctx = mocks.runLoopSpec.mock.calls[0]?.[1] as TriggerContext;
    expect(ctx.trigger_kind).toBe("cron");
    expect(ctx.trigger_ref).toBe("auto_archive_sweep");
    stop();
  });

  it("ignores a manual trigger", async () => {
    registerLoop(eventSpec({ trigger: { kind: "manual" } }));
    const f = fakeKernel();
    const stop = startLoops({ kernel: f.kernel, logger });
    expect(f.jobs.size).toBe(0);
    f.emit("note.created", { id: "n1" });
    await settle();
    expect(mocks.runLoopSpec).not.toHaveBeenCalled();
    stop();
  });

  it("returns a stop function that unsubscribes", async () => {
    registerLoop(eventSpec());
    const f = fakeKernel();
    startLoops({ kernel: f.kernel, logger })();
    f.emit("note.created", { id: "n1" });
    await settle();
    expect(mocks.runLoopSpec).not.toHaveBeenCalled();
  });
});
