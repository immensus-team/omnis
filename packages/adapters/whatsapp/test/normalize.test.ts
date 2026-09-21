import type { NormalizedItem } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import {
  CHANNEL,
  POLL_MS,
  WS_RECONNECT_DEGRADE,
  WS_WINDOW_MS,
  isWhatsAppChat,
  mapApiError,
  normalize,
} from "../src/index.js";

const CHAT_ID = "!whatsapp_15550101002:ba_EvYDBBsZbRQAy3UOSWqG0LuTVkc.local-whatsapp.localhost";

function message(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "1343993",
    accountID: "local-whatsapp_ba_EvYDBBsZbRQAy3UOSWqG0LuTVkc",
    chatID: CHAT_ID,
    senderID: "@15550101002:local-whatsapp.localhost",
    senderName: "Dana Lee",
    timestamp: "2026-09-22T09:14:03.621Z",
    type: "TEXT",
    text: "hi",
    isDeleted: false,
    attachments: [],
    ...over,
  };
}

/** `noUncheckedIndexedAccess` makes every index read `T | undefined`; these tests are about the one
 *  item a message produces, so the assertion lives here rather than being re-cast at each call site. */
function firstItem(raw: unknown): NormalizedItem {
  const [item] = normalize(raw);
  if (item === undefined) throw new Error(`expected one item, got none for ${JSON.stringify(raw)}`);
  return item;
}

describe("WhatsApp constants", () => {
  it("pins the channel and the A1 §2.6 / A1-D3 thresholds", () => {
    expect(CHANNEL).toBe("whatsapp");
    // A1 §2.6: the experimental WS runs in parallel with a 1-minute REST poll.
    expect(POLL_MS).toBe(60_000);
    // A1-D3: "WS reconnects 3 or more times during a 30-minute observation".
    expect(WS_RECONNECT_DEGRADE).toBe(3);
    expect(WS_WINDOW_MS).toBe(30 * 60_000);
  });
});

describe("isWhatsAppChat()", () => {
  it("accepts the whatsapp network, whatever case Beeper reports it in", () => {
    expect(isWhatsAppChat({ network: "whatsapp" })).toBe(true);
    expect(isWhatsAppChat({ network: "WhatsApp" })).toBe(true);
  });

  it("rejects another network even when the account id looks like WhatsApp", () => {
    // The network field is authoritative: falling through to the accountID heuristic here would let a
    // mislabelled account through.
    expect(isWhatsAppChat({ network: "telegram", accountID: "local-whatsapp_ba_x" })).toBe(false);
    expect(isWhatsAppChat({ network: "signal" })).toBe(false);
  });

  it("falls back to the account id when the payload carries no network", () => {
    // A message payload has no `network` in the Desktop API schema — only the chat does.
    expect(isWhatsAppChat({ accountID: "local-whatsapp_ba_EvYDBBsZbRQAy3UOSWqG0LuTVkc" })).toBe(
      true,
    );
    expect(isWhatsAppChat({ accountID: "local-telegram_ba_ZzQwMTIzNDU2Nzg5" })).toBe(false);
  });

  it("treats an empty or missing network as absent rather than as a mismatch", () => {
    // The accountID is what separates "absent" from "mismatch" here: `{ network: "" }` alone would be
    // false under either reading, so it cannot tell the two apart on its own.
    expect(isWhatsAppChat({ network: "", accountID: "local-whatsapp_ba_x" })).toBe(true);
    expect(isWhatsAppChat({ network: "" })).toBe(false);
    expect(isWhatsAppChat({})).toBe(false);
  });

  it("tolerates a padded network value rather than dropping the whole chat", () => {
    // A padded value read as a mismatch is not a mislabelled chat, it is a lost one: listWhatsAppChats
    // skips the chat and every message in it never becomes an item.
    expect(isWhatsAppChat({ network: " WhatsApp " })).toBe(true);
    expect(isWhatsAppChat({ network: "whatsapp\n" })).toBe(true);
  });
});

describe("normalize() drops what it cannot represent", () => {
  it("yields nothing for a non-object payload", () => {
    expect(normalize(null)).toEqual([]);
    expect(normalize("message.upserted")).toEqual([]);
    expect(normalize(42)).toEqual([]);
  });

  it("yields nothing without an id, a chat id or a sender", () => {
    expect(normalize(message({ id: undefined }))).toEqual([]);
    expect(normalize(message({ chatID: undefined }))).toEqual([]);
    expect(normalize(message({ senderID: undefined }))).toEqual([]);
  });

  it("yields nothing when the timestamp does not read as a date", () => {
    // sentAt has to be a valid ISO string; an epoch stamp would put the message in 1970 on the
    // timeline, so the row is dropped instead (the same call linkedin's extractor makes).
    expect(normalize(message({ timestamp: "not a date" }))).toEqual([]);
    expect(normalize(message({ timestamp: undefined }))).toEqual([]);
    // Epoch *seconds*: the one numeric value that would otherwise be silently mis-dated rather than
    // dropped — read as milliseconds it lands in 1970, at the very top of the timeline.
    expect(normalize(message({ timestamp: 1758531243 }))).toEqual([]);
  });

  it("drops an out-of-range numeric timestamp instead of throwing", () => {
    // `new Date(x).toISOString()` throws RangeError once x leaves the Date range (|x| > 8.64e15), and
    // normalize() throwing is not survivable: on the WS path it escapes the event callback, and on the
    // poll path it turns every pass into "down" with a cursor that can never advance. A bad `ts` is a
    // dropped row, not an exception (the same `Number.isFinite(getTime())` guard the string path uses).
    expect(normalize(message({ timestamp: 8.64e15 + 1 }))).toEqual([]);
    expect(normalize(message({ timestamp: 1e18 }))).toEqual([]);
    expect(normalize(message({ timestamp: Number.POSITIVE_INFINITY }))).toEqual([]);
  });

  it("keeps sentAt inside the four-digit years its own schema accepts", () => {
    // `sentAt` is `z.string().datetime()` (packages/protocol/src/adapter.ts:104) and zod's datetime regex
    // takes a four-digit year, so `toISOString()`'s extended years — `8.64e15` renders
    // `+275760-09-13T00:00:00.000Z` — are a shape the protocol's own type rejects: an item the kernel
    // would call invalid. Both forms can render one, so the ceiling is on the resolved epoch rather than
    // on the numeric input alone, and a value past it is a dropped row like any other unrepresentable one.
    expect(firstItem(message({ timestamp: 253_402_300_799_999 })).sentAt).toBe(
      "9999-12-31T23:59:59.999Z",
    );
    expect(normalize(message({ timestamp: 253_402_300_800_000 }))).toEqual([]);
    expect(normalize(message({ timestamp: 8.64e15 }))).toEqual([]);
    expect(normalize(message({ timestamp: "+275760-09-13T00:00:00.000Z" }))).toEqual([]);
  });

  it("yields nothing for a chat payload, which carries no message content", () => {
    expect(
      normalize({ type: "chat.upserted", data: { id: CHAT_ID, network: "whatsapp" } }),
    ).toEqual([]);
  });

  it("yields nothing for an unknown event kind", () => {
    expect(normalize({ type: "presence.changed", data: message() })).toEqual([]);
  });
});

describe("normalize() shape", () => {
  it("keys the item on the Beeper message id and threads it on the chat id", () => {
    const item = firstItem(message());
    expect(item.threadExternalId).toBe(CHAT_ID);
    expect(item.externalId).toBe("1343993");
    expect(item.sourceHash).toBe("1343993");
    expect(item.body).toBe("hi");
    expect(item.author).toEqual({ kind: "person", id: "@15550101002:local-whatsapp.localhost" });
  });

  it("reads the threadMeta of a chat-less message off its sender alone", () => {
    const item = firstItem(message());
    expect(item.threadMeta).toEqual({
      externalId: CHAT_ID,
      kind: "dm",
      title: null,
      participants: [
        {
          externalId: "@15550101002:local-whatsapp.localhost",
          displayName: "Dana Lee",
        },
      ],
      lastItemAt: "2026-09-22T09:14:03.621Z",
      archivedAt: null,
    });
  });

  it("accepts a bare message payload as well as an event envelope", () => {
    // The REST poll hands normalize() the row directly; the WS hands it the event. Both have to reach
    // the same item or the two paths would double-insert.
    // The length is asserted first: comparing the two calls alone also passes when both are [].
    expect(normalize(message())).toHaveLength(1);
    expect(normalize(message())).toEqual(normalize({ type: "message.upserted", data: message() }));
  });

  it("reads a whole entries array as one item per entry", () => {
    // The real `message.upserted` frame carries `entries` — plural — so the shape is understood here,
    // where the contract fixtures can pin it, rather than only on the WS path.
    const items = normalize({
      type: "message.upserted",
      data: [message(), message({ id: "1343994", text: "and one more" })],
    });
    expect(items.map((item) => item.externalId)).toEqual(["1343993", "1343994"]);
    expect(
      normalize([message(), message({ id: "1343995" })]).map((item) => item.externalId),
    ).toEqual(["1343993", "1343995"]);
  });

  it("reads a numeric WS `ts` as epoch milliseconds", () => {
    // The frame's `ts` is epoch ms (the docs' own example is `ts: 1739320000000`), so a client that
    // forwards it verbatim is read correctly rather than dropped.
    expect(firstItem(message({ timestamp: 1758531243000 })).sentAt).toBe(
      "2025-09-22T08:54:03.000Z",
    );
  });

  it("falls back to the sender id when Beeper resolves no display name", () => {
    const item = firstItem(message({ senderName: undefined }));
    expect(item.threadMeta?.participants).toEqual([
      {
        externalId: "@15550101002:local-whatsapp.localhost",
        displayName: "@15550101002:local-whatsapp.localhost",
      },
    ]);
  });
});

describe("mapApiError()", () => {
  it("reads a 429 as a rate limit and carries the retry delay", () => {
    const err = mapApiError({ status: 429, message: "Too many requests", retryAfterMs: 30_000 });
    expect(err.kind).toBe("retryable_rate_limit");
    expect(err.retryAfterMs).toBe(30_000);
    expect(err.channel).toBe("whatsapp");
  });

  it("reads a revoked token as auth_expired, with no retry delay", () => {
    const err = mapApiError({ status: 401, message: "Invalid or expired access token" });
    expect(err.kind).toBe("auth_expired");
    expect(err.retryAfterMs).toBeUndefined();
  });

  it("leaves anything else as a transient network fault", () => {
    expect(mapApiError({ status: 500, message: "Internal error" }).kind).toBe("retryable_network");
    expect(mapApiError(new Error("fetch failed")).kind).toBe("retryable_network");
    expect(mapApiError(undefined).kind).toBe("retryable_network");
  });

  it("keeps the original cause for the log line", () => {
    const cause = new Error("fetch failed");
    expect(mapApiError(cause).cause).toBe(cause);
  });
});
