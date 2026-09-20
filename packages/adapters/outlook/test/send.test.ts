import { describe, expect, it, vi } from "vitest";
import { createOutlookAdapter } from "../src/index.js";
import type { GraphClientLike } from "../src/index.js";

describe("Outlook write-back", () => {
  it("send() only calls the injected mock sink, never a real API", async () => {
    const sink = vi.fn(async () => ({ externalId: "sent-1", sentAt: "2023-11-14T00:00:00.000Z" }));
    const adapter = createOutlookAdapter({ oauthClientId: "c", sink });
    const result = await adapter.send({ accountId: "a", externalId: "conv-1" }, { text: "hi" });
    expect(sink).toHaveBeenCalledOnce();
    expect(result.externalId).toBe("sent-1");
  });

  it("markRead() PATCHes isRead and archive() POSTs a move to the Archive folder", async () => {
    const patch = vi.fn(async () => ({}));
    const post = vi.fn(async () => ({}));
    const graphClient: GraphClientLike = { api: () => ({ get: async () => ({}), patch, post }) };
    const adapter = createOutlookAdapter({ oauthClientId: "c", graphClient });
    await adapter.connect({
      channel: "outlook",
      accountExternalId: "logan@outlook.com",
      keychainService: "s",
      keychainAccount: "a",
    });
    await adapter.markRead?.({ accountId: "a", externalId: "msg-1" });
    expect(patch).toHaveBeenCalledWith({ isRead: true });
    await adapter.archive?.({ accountId: "a", externalId: "msg-1" });
    expect(post).toHaveBeenCalledWith({ destinationId: "archive" });
  });
});
