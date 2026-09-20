// packages/agents/test/memory-consolidate.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_BATCH_MODEL,
  MEMORY_CONSOLIDATE_CRON,
  harvestConsolidation,
  submitConsolidation,
} from "../src/index.js";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("memory consolidation via Message Batches (A4 §6.5)", () => {
  it("submits at 23:30 KST with the T2 model", () => {
    expect(MEMORY_CONSOLIDATE_CRON).toBe("30 23 * * *");
    expect(ANTHROPIC_BATCH_MODEL).toBe("claude-sonnet-5");
  });

  it("returns null without sending when the API key is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("OMNIS_ANTHROPIC_API_KEY", "");
    expect(await submitConsolidation([{ custom_id: "m1", prompt: "summarize this" }])).toBe(null);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts one batch request per candidate and returns the batch id", async () => {
    const fetchSpy = vi.fn(async () =>
      json({ id: "msgbatch_1", processing_status: "in_progress" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("OMNIS_ANTHROPIC_API_KEY", "sk-test");
    const id = await submitConsolidation([
      { custom_id: "m1", prompt: "a" },
      { custom_id: "m2", prompt: "b" },
    ]);
    expect(id).toBe("msgbatch_1");
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      requests: { custom_id: string; params: { model: string } }[];
    };
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0]?.params.model).toBe(ANTHROPIC_BATCH_MODEL);
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns an empty harvest while the batch is still running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          id: "msgbatch_1",
          processing_status: "in_progress",
        }),
      ),
    );
    vi.stubEnv("OMNIS_ANTHROPIC_API_KEY", "sk-test");
    expect(await harvestConsolidation("msgbatch_1")).toEqual([]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
