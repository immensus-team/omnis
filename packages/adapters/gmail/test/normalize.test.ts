import { NormalizedItem } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import { normalize } from "../src/index.js";

describe("Gmail normalize()", () => {
  it("maps a plain-text message resource and validates against NormalizedItem", () => {
    const raw = {
      id: "18c2f4a1b2d3e4f5",
      threadId: "18c2f4a1b2d3e4f0",
      payload: {
        headers: [
          { name: "From", value: "Dana Lee <dana@example.com>" },
          { name: "Subject", value: "omnis launch sync" },
          { name: "Message-Id", value: "<CAFakeMsgId001@mail.gmail.com>" },
          { name: "Date", value: "Tue, 14 Nov 2023 22:13:20 +0000" },
        ],
        mimeType: "text/plain",
        body: { data: "TGV0J3Mgc3luYyB0b21vcnJvdyBhdCAxMGFtIGFib3V0IHRoZSBvbW5pcyBsYXVuY2gu" },
      },
    };
    const [item] = normalize(raw);
    expect(() => NormalizedItem.parse(item)).not.toThrow();
    expect(item).toMatchObject({
      threadExternalId: "18c2f4a1b2d3e4f0",
      externalId: "18c2f4a1b2d3e4f5",
      kind: "email",
      // The mailbox, not the header — the same key the participants list uses, so the kernel's
      // display-name lookup (ingest.ts: participants.find(p => p.externalId === author.id)) hits.
      author: { kind: "person", id: "dana@example.com" },
      body: "Subject: omnis launch sync\n\nLet's sync tomorrow at 10am about the omnis launch.",
      sentAt: "2023-11-14T22:13:20.000Z",
      status: "received",
      sourceHash: "<CAFakeMsgId001@mail.gmail.com>",
      threadMeta: {
        externalId: "18c2f4a1b2d3e4f0",
        kind: "email",
        title: "omnis launch sync",
        participants: [{ externalId: "dana@example.com", displayName: "Dana Lee" }],
        lastItemAt: "2023-11-14T22:13:20.000Z",
        archivedAt: null,
      },
    });
  });

  it("keeps a quoted display name with a comma as one participant, keyed by mailbox", () => {
    const raw = {
      id: "m2",
      threadId: "t2",
      payload: {
        headers: [
          { name: "From", value: '"Lee, Dana" <dana@example.com>' },
          { name: "To", value: "dana@example.com, Bob <bob@example.com>" },
          { name: "Date", value: "Tue, 14 Nov 2023 22:13:20 +0000" },
        ],
        body: { data: "" },
      },
    };
    const [item] = normalize(raw);
    expect(item?.threadMeta?.participants).toEqual([
      { externalId: "dana@example.com", displayName: "Lee, Dana" },
      { externalId: "bob@example.com", displayName: "Bob" },
    ]);
  });

  it("dedupes participants across From/To/Cc", () => {
    const raw = {
      id: "m1",
      threadId: "t1",
      payload: {
        headers: [
          { name: "From", value: "a@example.com" },
          { name: "To", value: "b@example.com, a@example.com" },
          { name: "Subject", value: "hi" },
          { name: "Date", value: "Tue, 14 Nov 2023 22:13:20 +0000" },
        ],
        body: { data: "" },
      },
    };
    const [item] = normalize(raw);
    expect(item?.threadMeta?.participants).toEqual([
      { externalId: "a@example.com", displayName: "a@example.com" },
      { externalId: "b@example.com", displayName: "b@example.com" },
    ]);
  });
});
