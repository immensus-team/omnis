import { describe, expect, it } from "vitest";
import type { RawConversation, RawMessage } from "../src/index.js";
import {
  CHANNEL,
  SelectorMissingError,
  mapError,
  nextPollDelayMs,
  normalize,
  sourceHash,
} from "../src/index.js";

const CONVERSATION_ID = "2-YWJjMTIz";

function conversation(over: Partial<RawConversation> = {}): RawConversation {
  return {
    conversationId: CONVERSATION_ID,
    title: "Dana Lee",
    participants: [
      { name: "Logan Kim", profileUrl: "https://www.linkedin.com/in/logan-kim" },
      { name: "Dana Lee", profileUrl: "https://www.linkedin.com/in/dana-lee-8b1c2" },
    ],
    lastActivityAt: "2026-09-22T09:14:03+09:00",
    unread: true,
    ...over,
  };
}

function message(over: Partial<RawMessage> = {}): RawMessage {
  return {
    conversationId: CONVERSATION_ID,
    ordinal: 0,
    senderName: "Dana Lee",
    senderProfileUrl: "https://www.linkedin.com/in/dana-lee-8b1c2",
    isMe: false,
    text: "sync tomorrow at 10am",
    sentAt: "2026-09-22T09:14:03+09:00",
    attachments: [],
    ...over,
  };
}

describe("LinkedIn sourceHash()", () => {
  it("is stable across calls and is a sha256", () => {
    const a = sourceHash(CONVERSATION_ID, 0, "2026-09-22T09:14:03+09:00");
    const b = sourceHash(CONVERSATION_ID, 0, "2026-09-22T09:14:03+09:00");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the conversation, the ordinal or the timestamp changes", () => {
    const base = sourceHash(CONVERSATION_ID, 0, "2026-09-22T09:14:03+09:00");
    const variants = [
      sourceHash("2-Zm9vYmFy", 0, "2026-09-22T09:14:03+09:00"),
      sourceHash(CONVERSATION_ID, 1, "2026-09-22T09:14:03+09:00"),
      sourceHash(CONVERSATION_ID, 0, "2026-09-22T09:15:00+09:00"),
    ];
    expect(new Set([base, ...variants]).size).toBe(4);
  });

  // A1 §2.9 keys the item on the DOM ordinal + timestamp, so the body is deliberately not part of the
  // key: re-reading a thread after an edit (or any re-render of the same row) must not duplicate.
  it("ignores the body and the sender", () => {
    expect(sourceHash(CONVERSATION_ID, 0, "t")).toBe(sourceHash(CONVERSATION_ID, 0, "t"));
  });

  // The ordinal is numeric, and 10 must not collide with 1 the way a naive string concat could.
  it("keeps adjacent ordinals apart", () => {
    expect(sourceHash(CONVERSATION_ID, 1, "t")).not.toBe(sourceHash(CONVERSATION_ID, 10, "t"));
    expect(sourceHash(CONVERSATION_ID, 1, "t")).not.toBe(sourceHash(CONVERSATION_ID, 11, "t"));
  });
});

describe("LinkedIn normalize()", () => {
  it("maps an extracted message and its conversation", () => {
    const [item] = normalize({ conversation: conversation(), messages: [message()] });
    expect(item?.threadExternalId).toBe(CONVERSATION_ID);
    expect(item?.kind).toBe("message");
    expect(item?.status).toBe("received");
    expect(item?.body).toBe("sync tomorrow at 10am");
    expect(item?.sentAt).toBe("2026-09-22T00:14:03.000Z");
    expect(item?.attachments).toEqual([]);
    expect(item?.author).toEqual({
      kind: "person",
      id: "https://www.linkedin.com/in/dana-lee-8b1c2",
    });
    expect(item?.sourceHash).toBe(sourceHash(CONVERSATION_ID, 0, "2026-09-22T09:14:03+09:00"));
    expect(item?.externalId).toBe(item?.sourceHash);
  });

  it("maps own messages to the local person", () => {
    const [item] = normalize({ conversation: conversation(), messages: [message({ isMe: true })] });
    expect(item?.author).toEqual({ kind: "person", id: "me" });
  });

  // The extractor cannot always read a profile URL — a member who hides theirs, or a "LinkedIn Member"
  // row. The display name is the only identity left, and an empty author id is not an option.
  it("falls back to the sender name when there is no profile URL", () => {
    const [item] = normalize({
      conversation: conversation(),
      messages: [message({ senderProfileUrl: "" })],
    });
    expect(item?.author).toEqual({ kind: "person", id: "Dana Lee" });
    const [anonymous] = normalize({
      conversation: conversation(),
      messages: [message({ senderProfileUrl: "", senderName: "" })],
    });
    expect(anonymous?.author).toEqual({ kind: "person", id: "unknown" });
  });

  it("carries attachment URLs through and keeps an attachment-only message", () => {
    const [item] = normalize({
      conversation: conversation(),
      messages: [
        message({
          text: "",
          attachments: [{ kind: "image", url: "https://media.linkedin.com/img/1.png" }],
        }),
      ],
    });
    expect(item?.body).toBe("");
    expect(item?.attachments).toEqual([
      { kind: "image", url: "https://media.linkedin.com/img/1.png" },
    ]);
  });

  it("falls back to a file attachment for an unknown kind, and drops a missing URL", () => {
    const [item] = normalize({
      conversation: conversation(),
      messages: [
        message({
          attachments: [
            { kind: "document", url: "https://media.linkedin.com/doc/1.pdf" },
            { kind: "image", url: "" },
          ],
        }),
      ],
    });
    expect(item?.attachments).toEqual([
      { kind: "file", url: "https://media.linkedin.com/doc/1.pdf" },
      { kind: "image" },
    ]);
  });

  it("builds threadMeta from the conversation and calls a two-person thread a dm", () => {
    const [item] = normalize({ conversation: conversation(), messages: [message()] });
    expect(item?.threadMeta).toEqual({
      externalId: CONVERSATION_ID,
      kind: "dm",
      title: "Dana Lee",
      participants: [
        { externalId: "https://www.linkedin.com/in/logan-kim", displayName: "Logan Kim" },
        { externalId: "https://www.linkedin.com/in/dana-lee-8b1c2", displayName: "Dana Lee" },
      ],
      lastItemAt: "2026-09-22T00:14:03.000Z",
      archivedAt: null,
    });
  });

  it("calls a conversation with more than two participants a group", () => {
    const [item] = normalize({
      conversation: conversation({
        title: "launch plan",
        participants: [
          { name: "Logan Kim", profileUrl: "https://www.linkedin.com/in/logan-kim" },
          { name: "Dana Lee", profileUrl: "https://www.linkedin.com/in/dana-lee-8b1c2" },
          { name: "Sam Park", profileUrl: "https://www.linkedin.com/in/sam-park" },
        ],
      }),
      messages: [message()],
    });
    expect(item?.threadMeta?.kind).toBe("group");
    expect(item?.threadMeta?.title).toBe("launch plan");
  });

  it("carries a null title when the conversation has none", () => {
    const [item] = normalize({
      conversation: conversation({ title: "" }),
      messages: [message()],
    });
    expect(item?.threadMeta?.title).toBeNull();
  });

  it("leaves threadMeta off a bare message payload", () => {
    const [item] = normalize({ messages: [message()] });
    expect(item?.threadMeta).toBeUndefined();
    expect(item?.threadExternalId).toBe(CONVERSATION_ID);
  });

  // The in-page extractor knows the conversation id once per thread, so a per-message copy may be
  // absent. Falling back to the enclosing conversation keeps the batch instead of dropping all of it.
  it("takes the conversation id from the enclosing conversation when a message omits it", () => {
    const { conversationId, ...withoutId } = message();
    expect(conversationId).toBe(CONVERSATION_ID);
    const [item] = normalize({ conversation: conversation(), messages: [withoutId] });
    expect(item?.threadExternalId).toBe(CONVERSATION_ID);
  });

  it("groups several messages into one thread with distinct ids and the latest lastItemAt", () => {
    const items = normalize({
      conversation: conversation(),
      messages: [
        message({ ordinal: 0 }),
        message({
          ordinal: 1,
          isMe: true,
          text: "works for me",
          sentAt: "2026-09-22T09:20:00+09:00",
        }),
      ],
    });
    expect(items.map((i) => i.threadExternalId)).toEqual([CONVERSATION_ID, CONVERSATION_ID]);
    expect(new Set(items.map((i) => i.externalId)).size).toBe(2);
    expect(items.map((i) => i.body)).toEqual(["sync tomorrow at 10am", "works for me"]);
    expect(items[0]?.threadMeta?.lastItemAt).toBe("2026-09-22T00:20:00.000Z");
  });

  it("drops a message that cannot be keyed, keeping the rest of the batch", () => {
    const items = normalize({
      conversation: conversation(),
      messages: [
        { ...message(), sentAt: "not a date" },
        { ...message(), ordinal: "0" },
        message({ ordinal: 2 }),
      ],
    });
    expect(items.map((i) => i.body)).toEqual(["sync tomorrow at 10am"]);
    expect(items[0]?.sourceHash).toBe(sourceHash(CONVERSATION_ID, 2, "2026-09-22T09:14:03+09:00"));
  });

  it("drops a message with no conversation id at all", () => {
    const { conversationId, ...withoutId } = message();
    expect(conversationId).toBe(CONVERSATION_ID);
    expect(normalize({ messages: [withoutId] })).toEqual([]);
  });

  // Neither text nor media is a row with nothing to show; telegram and slack drop it too, which is what
  // makes "every stored item has a body or an attachment" an invariant rather than a coincidence.
  it("drops a row with neither text nor attachments, keeping the rest of the batch", () => {
    const items = normalize({
      conversation: conversation(),
      messages: [message({ text: "", attachments: [] }), message({ ordinal: 3, text: "kept" })],
    });
    expect(items.map((i) => i.body)).toEqual(["kept"]);
  });

  // `{ error: {...} }` is the extractor's failure envelope, not a message payload — the error itself is
  // classified by mapError(), never turned into an item.
  it("yields nothing for a non-message payload", () => {
    expect(normalize({ error: { message: "selector not found" } })).toEqual([]);
    expect(normalize({ messages: [] })).toEqual([]);
    expect(normalize({})).toEqual([]);
    expect(normalize(null)).toEqual([]);
    expect(normalize("text")).toEqual([]);
    expect(normalize(undefined)).toEqual([]);
  });
});

describe("LinkedIn mapError()", () => {
  it("maps throttling to retryable_rate_limit", () => {
    expect(mapError(new Error("too many requests (HTTP 429)")).kind).toBe("retryable_rate_limit");
    expect(mapError({ error: "You have reached the weekly invitation limit." }).kind).toBe(
      "retryable_rate_limit",
    );
  });

  it("maps a logged-out session to auth_expired", () => {
    expect(mapError(new Error("LinkedIn is not logged in")).kind).toBe("auth_expired");
    expect(mapError({ error: "Session expired, please sign in" }).kind).toBe("auth_expired");
  });

  // A1 §2.9: a LinkedIn UI update breaks the DOM selectors. That is a manual-deploy fix, so it reads as
  // fatal_protocol — which the adapter reports as `degraded` rather than `down`.
  it("maps a missing selector to fatal_protocol, however it is reported", () => {
    expect(mapError(new SelectorMissingError("div.msg-s-message-list")).kind).toBe(
      "fatal_protocol",
    );
    expect(mapError({ error: { selector: "div.msg-s-message-list" } }).kind).toBe("fatal_protocol");
    expect(mapError({ error: "selector .msg-overlay-bubble not found" }).kind).toBe(
      "fatal_protocol",
    );
    expect(mapError(new Error("SelectorMissingError: nav rail")).kind).toBe("fatal_protocol");
  });

  it("names the selector it could not find", () => {
    expect(mapError(new SelectorMissingError("div.msg-s-message-list")).message).toContain(
      "div.msg-s-message-list",
    );
  });

  it("maps a dead browser or a network fault to retryable_network, and that is the default", () => {
    expect(mapError(new Error("browser has been closed")).kind).toBe("retryable_network");
    expect(mapError(new Error("Navigation timeout of 30000 ms exceeded")).kind).toBe(
      "retryable_network",
    );
    const err = mapError(new Error("something else"));
    expect(err.kind).toBe("retryable_network");
    expect(err.channel).toBe(CHANNEL);
  });

  it("reads a message out of an object, a string or an Error", () => {
    expect(mapError("too many requests").message).toContain("too many requests");
    expect(mapError({ message: "too many requests" }).message).toContain("too many requests");
    expect(mapError({ error: "too many requests" }).message).toContain("too many requests");
  });
});

describe("LinkedIn nextPollDelayMs()", () => {
  it("hits both ends of the 5-15 minute window", () => {
    expect(nextPollDelayMs(() => 0)).toBe(300_000);
    expect(nextPollDelayMs(() => 1)).toBe(900_000);
    expect(nextPollDelayMs(() => 0.5)).toBe(600_000);
  });

  it("stays in range for real random values", () => {
    for (let i = 0; i < 200; i += 1) {
      const ms = nextPollDelayMs();
      expect(ms).toBeGreaterThanOrEqual(300_000);
      expect(ms).toBeLessThanOrEqual(900_000);
      expect(Number.isInteger(ms)).toBe(true);
    }
  });
});
