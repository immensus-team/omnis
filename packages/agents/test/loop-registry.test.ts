import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type LoopSpec,
  PhantomToolError,
  getLoop,
  listLoops,
  registerLoop,
  resetLoopRegistryForTest,
} from "../src/index.js";

const noop = async (): Promise<void> => undefined;

function spec(over: Partial<LoopSpec<{ ok: boolean }>> = {}): LoopSpec<{ ok: boolean }> {
  return {
    id: "note_route",
    kind: "reactive",
    trigger: { kind: "event", on: "note.created", debounceMs: 2000 },
    palette: ["search_memory", "propose_route"],
    budget: { inputTokens: 4000, outputTokens: 450, wallClockMs: 20_000, maxSteps: 2 },
    tier: "T1",
    outputSchema: z.object({ ok: z.boolean() }),
    assemble: async () => ({
      cachedPrefix: "",
      volatile: [],
      tokenEstimate: 0,
      truncated: false,
      provenance: [],
    }),
    apply: noop,
    ...over,
  };
}

describe("loop registry (A4 §1.1)", () => {
  beforeEach(() => resetLoopRegistryForTest());

  it("registers and looks a loop up by id", () => {
    registerLoop(spec());
    expect(getLoop("note_route").tier).toBe("T1");
    expect(listLoops().map((s) => s.id)).toEqual(["note_route"]);
  });

  it("refuses a duplicate id", () => {
    registerLoop(spec());
    expect(() => registerLoop(spec())).toThrow(/already registered/);
  });

  it("refuses any phantom tool in the palette (A4 §1.5)", () => {
    for (const phantom of ["send_message", "archive", "exec", "read_secret"]) {
      resetLoopRegistryForTest();
      expect(() => registerLoop(spec({ palette: ["read_thread", phantom] as never }))).toThrow(
        PhantomToolError,
      );
    }
  });

  it("refuses a schedule trigger without cron and an event trigger without on", () => {
    expect(() => registerLoop(spec({ trigger: { kind: "schedule" } }))).toThrow(/cron/);
    resetLoopRegistryForTest();
    expect(() => registerLoop(spec({ trigger: { kind: "event" } }))).toThrow(/on/);
  });

  it("refuses a non-positive budget", () => {
    expect(() =>
      registerLoop(
        spec({ budget: { inputTokens: 0, outputTokens: 1, wallClockMs: 1, maxSteps: 1 } }),
      ),
    ).toThrow(/inputTokens/);
  });
});
