import { describe, expect, it, vi } from "vitest";
import { createGmailAdapter } from "../src/index.js";

describe("Gmail adapter send()", () => {
  it("calls only the injected sink, never gmail.users.messages.send", async () => {
    const sink = vi
      .fn()
      .mockResolvedValue({ externalId: "18c2f4a1b2d3e4ff", sentAt: "2023-11-14T22:30:00.000Z" });
    const gmailClient = { users: { messages: { send: vi.fn() } } } as never;
    const adapter = createGmailAdapter({
      oauthClientId: "id",
      oauthClientSecret: "secret",
      gmailClient,
      sink,
    });

    const result = await adapter.send(
      { accountId: "acc-1", externalId: "18c2f4a1b2d3e4f0" },
      { text: "approved reply" },
    );

    expect(sink).toHaveBeenCalledTimes(1);
    expect(result.externalId).toBe("18c2f4a1b2d3e4ff");
    expect(
      (gmailClient as { users: { messages: { send: ReturnType<typeof vi.fn> } } }).users.messages
        .send,
    ).not.toHaveBeenCalled();
  });
});
