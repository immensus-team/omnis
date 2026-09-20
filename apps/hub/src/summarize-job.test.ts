import type { Events, Logger } from "@omnis/kernel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSummaryJob } from "./summarize-job.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function fakeEvents(): { events: Events; fire: (p: Record<string, unknown>) => void } {
  let handler: ((p: Record<string, unknown>) => void) | undefined;
  const events: Events = {
    async emit() {},
    subscribe(_channel, fn) {
      handler = fn;
      return () => {
        handler = undefined;
      };
    },
  };
  return { events, fire: (p) => handler?.(p) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("registerSummaryJob", () => {
  it("debounces a burst of item.created on one thread into a single summarizeThread call", () => {
    const { events, fire } = fakeEvents();
    const summarizeThread = vi.fn().mockResolvedValue(null);
    registerSummaryJob({ events, logger, summarizeThread, debounceMs: 30_000 });

    fire({ id: "i1", thread_id: "t1", op: "insert" });
    fire({ id: "i2", thread_id: "t1", op: "insert" });
    fire({ id: "i3", thread_id: "t1", op: "insert" });
    expect(summarizeThread).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(summarizeThread).toHaveBeenCalledTimes(1);
    expect(summarizeThread).toHaveBeenCalledWith("t1");
  });

  it("ignores item.updated (op !== insert) and payloads without a string thread_id", () => {
    const { events, fire } = fakeEvents();
    const summarizeThread = vi.fn().mockResolvedValue(null);
    registerSummaryJob({ events, logger, summarizeThread, debounceMs: 30_000 });

    fire({ id: "i1", thread_id: "t1", op: "update" });
    fire({ id: "i2", op: "insert" }); // no thread_id
    vi.advanceTimersByTime(30_000);
    expect(summarizeThread).not.toHaveBeenCalled();
  });

  it("debounces each thread independently", () => {
    const { events, fire } = fakeEvents();
    const summarizeThread = vi.fn().mockResolvedValue(null);
    registerSummaryJob({ events, logger, summarizeThread, debounceMs: 30_000 });

    fire({ id: "i1", thread_id: "t1", op: "insert" });
    fire({ id: "i2", thread_id: "t2", op: "insert" });
    vi.advanceTimersByTime(30_000);
    expect(summarizeThread).toHaveBeenCalledTimes(2);
    expect(summarizeThread).toHaveBeenCalledWith("t1");
    expect(summarizeThread).toHaveBeenCalledWith("t2");
  });

  it("fires again for a new burst after the window closes", () => {
    const { events, fire } = fakeEvents();
    const summarizeThread = vi.fn().mockResolvedValue(null);
    registerSummaryJob({ events, logger, summarizeThread, debounceMs: 30_000 });

    fire({ id: "i1", thread_id: "t1", op: "insert" });
    vi.advanceTimersByTime(30_000);
    expect(summarizeThread).toHaveBeenCalledTimes(1);

    fire({ id: "i2", thread_id: "t1", op: "insert" });
    vi.advanceTimersByTime(30_000);
    expect(summarizeThread).toHaveBeenCalledTimes(2);
  });

  it("logs instead of throwing when summarizeThread rejects", async () => {
    const { events, fire } = fakeEvents();
    const error = vi.fn();
    const summarizeThread = vi.fn().mockRejectedValue(new Error("db down"));
    registerSummaryJob({
      events,
      logger: { ...logger, error },
      summarizeThread,
      debounceMs: 30_000,
    });

    fire({ id: "i1", thread_id: "t1", op: "insert" });
    vi.advanceTimersByTime(30_000);
    // The rejection thrown by the timer callback is handled in a microtask — let one real timer tick pass.
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 0));
    expect(error).toHaveBeenCalledWith(
      "summarizeThread failed",
      expect.objectContaining({ threadId: "t1", err: "db down" }),
    );
  });

  it("unsubscribes cleanly when the returned function is called", () => {
    const { events, fire } = fakeEvents();
    const summarizeThread = vi.fn().mockResolvedValue(null);
    const off = registerSummaryJob({ events, logger, summarizeThread, debounceMs: 30_000 });
    off();
    fire({ id: "i1", thread_id: "t1", op: "insert" });
    vi.advanceTimersByTime(30_000);
    expect(summarizeThread).not.toHaveBeenCalled();
  });
});
