import { describe, expect, it, vi } from "vitest";
import { createOutlookAdapter } from "../src/index.js";
import type { GraphClientLike } from "../src/index.js";

function fakeAuth() {
  return {
    channel: "outlook" as const,
    accountExternalId: "logan@outlook.com",
    keychainService: "omnis.outlook.logan@outlook.com",
    keychainAccount: "logan@outlook.com",
  };
}

describe("Outlook backfill()", () => {
  it("paginates /me/mailFolders/inbox/messages via @odata.nextLink", async () => {
    const pages = [
      {
        value: [
          {
            id: "m1",
            conversationId: "c1",
            internetMessageId: "<m1>",
            from: { emailAddress: { address: "a@x.com" } },
            body: { contentType: "text", content: "hi" },
            receivedDateTime: "2023-11-14T00:00:00Z",
          },
        ],
        "@odata.nextLink": "page2",
      },
      {
        value: [
          {
            id: "m2",
            conversationId: "c1",
            internetMessageId: "<m2>",
            from: { emailAddress: { address: "a@x.com" } },
            body: { contentType: "text", content: "bye" },
            receivedDateTime: "2023-11-15T00:00:00Z",
          },
        ],
      },
    ];
    let call = 0;
    const graphClient: GraphClientLike = {
      api: () => ({
        get: async () => pages[call++] as Record<string, unknown>,
        patch: async () => ({}),
        post: async () => ({}),
      }),
    };
    const adapter = createOutlookAdapter({ oauthClientId: "c", graphClient });
    await adapter.connect(fakeAuth());
    const items = [];
    for await (const item of adapter.backfill()) items.push(item);
    expect(items.map((i) => i.externalId)).toEqual(["m1", "m2"]);
  });
});

describe("Outlook subscribe()", () => {
  it("resets to the base delta URL on 410 and keeps yielding", async () => {
    let call = 0;
    const graphClient: GraphClientLike = {
      api: () => ({
        get: async () => {
          call += 1;
          if (call === 1) {
            const err = new Error("Gone") as Error & { statusCode: number };
            err.statusCode = 410;
            throw err;
          }
          return {
            value: [
              {
                id: "m3",
                conversationId: "c3",
                internetMessageId: "<m3>",
                from: { emailAddress: { address: "b@x.com" } },
                body: { contentType: "text", content: "new" },
                receivedDateTime: "2023-11-16T00:00:00Z",
              },
            ],
            "@odata.deltaLink": "delta-2",
          };
        },
        patch: async () => ({}),
        post: async () => ({}),
      }),
    };
    const adapter = createOutlookAdapter({ oauthClientId: "c", graphClient, pollIntervalMs: 0 });
    await adapter.connect(fakeAuth());
    const it1 = adapter.subscribe()[Symbol.asyncIterator]();
    const first = await it1.next();
    expect(first.done).toBe(false);
    expect((first.value as { externalId?: string }).externalId).toBe("m3");
  });
});
