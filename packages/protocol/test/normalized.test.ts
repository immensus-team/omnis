import { describe, expect, it } from "vitest";
import { Capabilities, NormalizedItem } from "../src/adapter.js";

describe("Capabilities", () => {
  it("rejects a missing field", () => {
    const missingDelete = {
      read: true, write: true, realtime: true, history: true,
      media: true, markRead: true, typing: false, archive: false,
    };
    expect(() => Capabilities.parse(missingDelete)).toThrow();
  });
});

describe("NormalizedItem", () => {
  it("accepts a minimal received message and defaults attachments to []", () => {
    const parsed = NormalizedItem.parse({
      threadExternalId: "C0123456789",
      externalId: "1700000000.000100",
      kind: "message",
      author: { kind: "person", id: "U0123456789" },
      body: "hey",
      attachments: [],
      sentAt: "2023-11-14T22:13:20.000Z",
      status: "received",
      sourceHash: "1700000000.000100",
    });
    expect(parsed.attachments).toEqual([]);
    expect(parsed.threadMeta).toBeUndefined();
  });

  it("rejects status other than 'received'", () => {
    expect(() =>
      NormalizedItem.parse({
        threadExternalId: "C1", externalId: "e1", kind: "message",
        author: { kind: "person", id: "U1" }, body: "hi", attachments: [],
        sentAt: "2023-11-14T22:13:20.000Z", status: "sent", sourceHash: "h1",
      }),
    ).toThrow();
  });
});
