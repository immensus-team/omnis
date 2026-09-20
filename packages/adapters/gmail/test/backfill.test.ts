import { describe, expect, it, vi } from "vitest";
import { createGmailAdapter } from "../src/index.js";

describe("Gmail adapter backfill()", () => {
  it("lists messages.list then fetches each message full resource", async () => {
    const list = vi.fn().mockResolvedValue({
      data: { messages: [{ id: "18c2f4a1b2d3e4f5" }], nextPageToken: undefined },
    });
    const get = vi.fn().mockResolvedValue({
      data: {
        id: "18c2f4a1b2d3e4f5",
        threadId: "18c2f4a1b2d3e4f0",
        payload: {
          headers: [
            { name: "From", value: "Dana Lee <dana@example.com>" },
            { name: "Subject", value: "omnis launch sync" },
            { name: "Message-Id", value: "<CAFakeMsgId001@mail.gmail.com>" },
          ],
          mimeType: "text/plain",
          body: { data: "TGV0J3Mgc3luYyB0b21vcnJvdyBhdCAxMGFtIGFib3V0IHRoZSBvbW5pcyBsYXVuY2gu" },
        },
      },
    });
    const gmailClient = { users: { messages: { list, get } } } as never;

    const adapter = createGmailAdapter({
      oauthClientId: "id",
      oauthClientSecret: "secret",
      gmailClient,
    });
    const collected = [];
    for await (const item of adapter.backfill()) collected.push(item);

    expect(collected).toHaveLength(1);
    expect(collected[0]?.threadExternalId).toBe("18c2f4a1b2d3e4f0");
    expect(collected[0]?.sourceHash).toBe("<CAFakeMsgId001@mail.gmail.com>");
    expect(collected[0]?.body).toContain("Let's sync tomorrow");
  });
});
