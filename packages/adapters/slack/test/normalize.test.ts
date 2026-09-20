import { describe, expect, it } from "vitest";
import { normalize } from "../src/index.js";

describe("Slack normalize()", () => {
  it("maps a plain channel message", () => {
    const raw = {
      type: "message",
      channel: "C0123456789",
      user: "U0123456789",
      text: "hey, can you review the PR?",
      ts: "1700000000.000100",
      team: "T0123456789",
    };
    expect(normalize(raw)).toEqual([
      {
        threadExternalId: "C0123456789",
        externalId: "1700000000.000100",
        kind: "message",
        author: { kind: "person", id: "U0123456789" },
        body: "hey, can you review the PR?",
        attachments: [],
        sentAt: "2023-11-14T22:13:20.000Z",
        status: "received",
        sourceHash: "1700000000.000100",
      },
    ]);
  });

  it("uses thread_ts for threadExternalId grouping but keeps ts as externalId/sourceHash", () => {
    const raw = {
      type: "message",
      channel: "C0123456789",
      user: "U0123456789",
      text: "reply",
      ts: "1700000100.000200",
      thread_ts: "1700000000.000100",
      team: "T0123456789",
    };
    const [item] = normalize(raw);
    expect(item?.externalId).toBe("1700000100.000200");
    expect(item?.sourceHash).toBe("1700000100.000200");
  });

  it("maps a file attachment", () => {
    const raw = {
      type: "message",
      channel: "C0123456789",
      user: "U0123456789",
      text: "see attached",
      ts: "1700000200.000300",
      team: "T0123456789",
      files: [
        {
          mimetype: "image/png",
          size: 2048,
          url_private: "https://files.slack.com/x/y.png",
          name: "y.png",
        },
      ],
    };
    const [item] = normalize(raw);
    expect(item?.attachments).toEqual([
      { kind: "image", mimeType: "image/png", sizeBytes: 2048, caption: "y.png" },
    ]);
  });
});
