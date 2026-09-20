import { describe, expect, it } from "vitest";
import { normalize } from "../src/index.js";

describe("Outlook normalize()", () => {
  it("maps a Graph message to a NormalizedItem keyed by conversationId/internetMessageId", () => {
    const items = normalize({
      id: "AAMkAGI1AAA=",
      conversationId: "AAQkAGI1conv",
      internetMessageId: "<msg-001@outlook.com>",
      subject: "omnis launch sync",
      body: { contentType: "text", content: "Let's sync tomorrow at 10am." },
      from: { emailAddress: { name: "Dana Lee", address: "dana@example.com" } },
      toRecipients: [{ emailAddress: { name: "Logan", address: "logan@example.com" } }],
      receivedDateTime: "2023-11-14T22:13:20Z",
    });
    expect(items).toEqual([
      {
        threadExternalId: "AAQkAGI1conv",
        externalId: "AAMkAGI1AAA=",
        kind: "email",
        author: { kind: "person", id: "dana@example.com" },
        body: "Subject: omnis launch sync\n\nLet's sync tomorrow at 10am.",
        attachments: [],
        sentAt: "2023-11-14T22:13:20.000Z",
        status: "received",
        sourceHash: "<msg-001@outlook.com>",
        threadMeta: {
          externalId: "AAQkAGI1conv",
          kind: "email",
          title: "omnis launch sync",
          participants: [
            { externalId: "dana@example.com", displayName: "Dana Lee" },
            { externalId: "logan@example.com", displayName: "Logan" },
          ],
          lastItemAt: "2023-11-14T22:13:20.000Z",
          archivedAt: null,
        },
      },
    ]);
  });

  it("strips HTML bodies and returns [] for delta tombstones (@removed)", () => {
    expect(
      normalize({
        id: "x",
        conversationId: "c",
        internetMessageId: "<m@x>",
        subject: "s",
        body: { contentType: "html", content: "<p>hi <b>there</b></p>" },
        from: { emailAddress: { address: "a@x.com" } },
        receivedDateTime: "2023-11-14T22:13:20Z",
      })[0]?.body,
    ).toBe("Subject: s\n\nhi there");
    expect(normalize({ id: "x", conversationId: "c", "@removed": { reason: "deleted" } })).toEqual(
      [],
    );
    expect(normalize({ id: "x" })).toEqual([]); // conversationId 없음
  });
});
