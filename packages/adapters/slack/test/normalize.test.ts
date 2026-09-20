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
        threadMeta: {
          externalId: "C0123456789",
          kind: "group",
          title: null,
          participants: [{ externalId: "U0123456789", displayName: "U0123456789" }],
          lastItemAt: "2023-11-14T22:13:20.000Z",
          archivedAt: null,
        },
      },
    ]);
  });

  it("marks a DM channel (D-prefixed id) as threadMeta.kind 'dm'", () => {
    const raw = {
      type: "message",
      channel: "D0123456789",
      user: "U0123456789",
      text: "hey",
      ts: "1700000000.000100",
    };
    const [item] = normalize(raw);
    expect(item?.threadMeta?.kind).toBe("dm");
  });

  it("titles a channel from channel_name with a # prefix, a DM without one", () => {
    const base = { type: "message", user: "U0123456789", text: "hey", ts: "1700000000.000100" };
    expect(
      normalize({ ...base, channel: "C0123456789", channel_name: "omnis-launch" })[0]?.threadMeta
        ?.title,
    ).toBe("#omnis-launch");
    expect(
      normalize({ ...base, channel: "D0123456789", channel_name: "dana" })[0]?.threadMeta?.title,
    ).toBe("dana");
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
