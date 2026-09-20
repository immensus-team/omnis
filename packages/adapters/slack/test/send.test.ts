import { describe, expect, it, vi } from "vitest";
import { createSlackAdapter } from "../src/index.js";

describe("Slack adapter send()", () => {
  it("calls only the injected sink, never a real Web API client", async () => {
    const sink = vi
      .fn()
      .mockResolvedValue({ externalId: "1700000300.000400", sentAt: "2023-11-14T22:20:00.000Z" });
    const webClient = { chat: { postMessage: vi.fn() } } as never;
    const adapter = createSlackAdapter({ webClient, sink });

    const result = await adapter.send(
      { accountId: "acc-1", externalId: "C0123456789" },
      { text: "approved reply" },
    );

    expect(sink).toHaveBeenCalledWith(
      { accountId: "acc-1", externalId: "C0123456789" },
      { text: "approved reply" },
    );
    expect(result.externalId).toBe("1700000300.000400");
    expect(
      (webClient as { chat: { postMessage: ReturnType<typeof vi.fn> } }).chat.postMessage,
    ).not.toHaveBeenCalled();
  });
});
