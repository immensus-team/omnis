import { describe, expect, it, vi } from "vitest";
import { createSlackAdapter } from "../src/index.js";

describe("Slack adapter backfill()", () => {
  it("paginates conversations.history and yields NormalizedItem per message", async () => {
    const historyPage1 = {
      ok: true,
      has_more: true,
      response_metadata: { next_cursor: "cursor-1" },
      messages: [{ type: "message", ts: "1700000000.000100", user: "U1", text: "first" }],
    };
    const historyPage2 = {
      ok: true,
      has_more: false,
      response_metadata: { next_cursor: "" },
      messages: [{ type: "message", ts: "1700000100.000200", user: "U1", text: "second" }],
    };
    const conversationsHistory = vi
      .fn()
      .mockResolvedValueOnce(historyPage1)
      .mockResolvedValueOnce(historyPage2);
    const webClient = { conversations: { history: conversationsHistory } } as never;

    const adapter = createSlackAdapter({ webClient });
    const collected: string[] = [];
    for await (const item of adapter.backfill()) collected.push(item.externalId);

    expect(collected).toEqual(["1700000000.000100", "1700000100.000200"]);
    expect(conversationsHistory).toHaveBeenCalledTimes(2);
    expect(conversationsHistory.mock.calls[1]?.[0]).toMatchObject({ cursor: "cursor-1" });
  });
});
