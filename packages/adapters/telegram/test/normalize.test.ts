import { describe, expect, it } from "vitest";
import { normalize } from "../src/index.js";

describe("Telegram normalize()", () => {
  it("maps a text message keyed by (chatId, messageId)", () => {
    const items = normalize({
      id: 501,
      chat: { id: 1001, type: "private" },
      sender: { id: 42, firstName: "Dana", lastName: "Lee" },
      text: "sync tomorrow at 10am",
      date: 1_700_000_000,
    });
    expect(items).toEqual([
      {
        threadExternalId: "1001",
        externalId: "501",
        kind: "message",
        author: { kind: "person", id: "42" },
        body: "sync tomorrow at 10am",
        attachments: [],
        sentAt: new Date(1_700_000_000 * 1000).toISOString(),
        status: "received",
        sourceHash: "1001:501",
        threadMeta: {
          externalId: "1001",
          kind: "dm",
          title: null,
          participants: [{ externalId: "42", displayName: "Dana Lee" }],
          lastItemAt: new Date(1_700_000_000 * 1000).toISOString(),
          archivedAt: null,
        },
      },
    ]);
  });

  it("keeps edited messages as a normal item and drops delete updates", () => {
    const edited = normalize({
      id: 501,
      chat: { id: 1001, type: "private" },
      sender: { id: 42, firstName: "Dana" },
      text: "sync tomorrow at 11am (edited)",
      date: 1_700_000_000,
      editDate: 1_700_000_500,
    });
    expect(edited[0]?.body).toBe("sync tomorrow at 11am (edited)");
    expect(normalize({ deletedMessageIds: [501], deletedChatId: 1001 })).toEqual([]);
    expect(normalize({ id: 1 })).toEqual([]); // no chat/sender
  });
});
