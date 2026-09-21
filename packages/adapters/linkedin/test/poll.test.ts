import type { NormalizedItem } from "@omnis/protocol";
import { AdapterError } from "@omnis/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LinkedInPageLike, RawConversation, RawMessage } from "../src/index.js";
import { SelectorMissingError, createLinkedInAdapter } from "../src/index.js";

const CONVERSATION_ID = "2-YWJjMTIz";

const auth = {
  channel: "linkedin" as const,
  accountExternalId: "logan-linkedin",
  keychainService: "omnis.linkedin",
  keychainAccount: "logan",
};

const fixedNow = (): Date => new Date("2026-09-22T00:00:00.000Z");

/** rand()=0 pins the poll cadence to the 5-minute floor of the 5-15 minute window. */
const POLL_MS = 300_000;

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
    text: "hi",
    sentAt: "2026-09-22T09:14:03+09:00",
    attachments: [],
    ...over,
  };
}

function fakePage(over: Partial<LinkedInPageLike> = {}): LinkedInPageLike {
  return {
    pollInbox: vi.fn(async () => [conversation()]),
    openThread: vi.fn(async () => [message()]),
    sendText: vi.fn(async () => ({ sentAt: "2026-09-22T00:00:00.000Z" })),
    ...over,
  };
}

/** A queue that pushed nothing leaves the iterator's promise pending: flush the microtask queue and
 *  check it never settled, which is how "no duplicate item" is asserted without a timeout. */
async function stillPending(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void p.then(() => {
    settled = true;
  });
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  return !settled;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LinkedIn capabilities()", () => {
  it("declares an approval-only writer, a poller, and a one-time history pass", () => {
    const adapter = createLinkedInAdapter({ page: fakePage() });
    expect(adapter.id).toBe("linkedin");
    expect(adapter.channel).toBe("linkedin");
    expect(adapter.capabilities()).toEqual({
      read: true,
      // No approval-gate sink, no write: the sink is what the approval path injects.
      write: false,
      realtime: false,
      history: true,
      media: true,
      markRead: false,
      typing: false,
      archive: false,
      delete: false,
    });
  });

  it("opens write once an approval-gate sink is wired", () => {
    const adapter = createLinkedInAdapter({
      page: fakePage(),
      sink: async () => ({ externalId: "li:sent", sentAt: "2026-09-22T00:00:00.000Z" }),
    });
    expect(adapter.capabilities().write).toBe(true);
    expect(adapter.capabilities().read).toBe(true);
  });
});

describe("LinkedIn connect()", () => {
  it("refuses to come up without a page", async () => {
    const adapter = createLinkedInAdapter();
    await expect(adapter.connect(auth)).rejects.toBeInstanceOf(AdapterError);
    await expect(adapter.connect(auth)).rejects.toMatchObject({ kind: "fatal_protocol" });
    expect((await adapter.health()).status).toBe("down");
  });

  it("reports healthy once a page is wired, with no account id of ours", async () => {
    const adapter = createLinkedInAdapter({ page: fakePage(), now: fixedNow });
    await adapter.connect(auth);
    const health = await adapter.health();
    expect(health.status).toBe("healthy");
    expect(health.channel).toBe("linkedin");
    // A1 §2.9 keeps the session in the Playwright profile — no Keychain item, so no account id.
    expect(health.accountExternalId).toBe("");
    expect(health.lastEventAt).toBe("2026-09-22T00:00:00.000Z");
    expect(health.lastError).toBeUndefined();
  });
});

describe("LinkedIn subscribe()", () => {
  it("polls on the 5-minute floor and emits what normalize() produces", async () => {
    vi.useFakeTimers();
    const page = fakePage();
    const adapter = createLinkedInAdapter({ page, now: fixedNow, rand: () => 0 });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    // connect() queued its `connected` event before subscribe() was called — drain it first.
    expect((await iterator.next()).value).toEqual({
      kind: "connected",
      at: "2026-09-22T00:00:00.000Z",
    });

    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(page.pollInbox).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(page.pollInbox).toHaveBeenCalledTimes(1);

    const item = (await iterator.next()).value as NormalizedItem;
    expect(item.body).toBe("hi");
    expect(item.threadExternalId).toBe(CONVERSATION_ID);
    expect(item.author).toEqual({
      kind: "person",
      id: "https://www.linkedin.com/in/dana-lee-8b1c2",
    });

    await adapter.disconnect();
  });

  it("re-reads the inbox on the cadence and emits only what is new", async () => {
    vi.useFakeTimers();
    const page = fakePage();
    const adapter = createLinkedInAdapter({ page, now: fixedNow, rand: () => 0 });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    await iterator.next(); // the `connected` event

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(((await iterator.next()).value as NormalizedItem).body).toBe("hi");

    // The next emission, held across two polls: the same DOM ordinal must not settle it...
    const next = iterator.next();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(page.pollInbox).toHaveBeenCalledTimes(3);
    expect(await stillPending(next)).toBe(true);

    // ...a genuinely new message (a new ordinal) must.
    vi.mocked(page.openThread).mockResolvedValue([
      message(),
      message({ ordinal: 1, text: "second", sentAt: "2026-09-22T09:20:00+09:00" }),
    ]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(((await next).value as NormalizedItem).body).toBe("second");

    await adapter.disconnect();
  });

  // A1 §2.9: the inbox is checked for new threads only — never a bulk profile view or a history walk.
  it("opens only the unread conversations, once each", async () => {
    vi.useFakeTimers();
    const page = fakePage({
      pollInbox: vi.fn(async () => [
        conversation({ conversationId: "2-unread-a", unread: true }),
        conversation({ conversationId: "2-read-b", unread: false }),
        conversation({ conversationId: "2-unread-c", unread: true }),
      ]),
      openThread: vi.fn(async (conversationId: string) => [
        message({ conversationId, text: `from ${conversationId}` }),
      ]),
    });
    const adapter = createLinkedInAdapter({ page, now: fixedNow, rand: () => 0 });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    await iterator.next();

    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(vi.mocked(page.openThread).mock.calls.map((c) => c[0])).toEqual([
      "2-unread-a",
      "2-unread-c",
    ]);
    const first = (await iterator.next()).value as NormalizedItem;
    const second = (await iterator.next()).value as NormalizedItem;
    expect([first.threadExternalId, second.threadExternalId]).toEqual(["2-unread-a", "2-unread-c"]);
    expect(await stillPending(iterator.next())).toBe(true);

    await adapter.disconnect();
  });

  it("goes degraded when a selector is missing, keeps polling, and needs no retry burst", async () => {
    vi.useFakeTimers();
    const page = fakePage({
      pollInbox: vi
        .fn(async () => [conversation()])
        .mockRejectedValueOnce(new SelectorMissingError("div.msg-s-message-list")),
    });
    const adapter = createLinkedInAdapter({ page, now: fixedNow, rand: () => 0 });
    await adapter.connect(auth);
    adapter.subscribe();

    await vi.advanceTimersByTimeAsync(POLL_MS);
    const health = await adapter.health();
    expect(health.status).toBe("degraded");
    expect(health.lastError?.kind).toBe("fatal_protocol");
    expect(health.lastError?.at).toBe("2026-09-22T00:00:00.000Z");

    // The next poll is the normal one, not a retry: nothing happens a second early.
    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(page.pollInbox).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(page.pollInbox).toHaveBeenCalledTimes(2);
    // A selector that comes back (a manual deploy) clears the flag on the next scheduled poll.
    expect((await adapter.health()).status).toBe("healthy");

    await adapter.disconnect();
  });

  // A dead browser is not a selector problem: it is `down`, and it still does not stop the loop.
  it("reports down for a browser fault and keeps polling", async () => {
    vi.useFakeTimers();
    const page = fakePage({
      pollInbox: vi.fn(async () => {
        throw new Error("browser has been closed");
      }),
    });
    const adapter = createLinkedInAdapter({ page, now: fixedNow, rand: () => 0 });
    await adapter.connect(auth);
    adapter.subscribe();

    await vi.advanceTimersByTimeAsync(POLL_MS);
    const health = await adapter.health();
    expect(health.status).toBe("down");
    expect(health.lastError?.kind).toBe("retryable_network");

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(page.pollInbox).toHaveBeenCalledTimes(2);

    await adapter.disconnect();
  });

  it("stops polling after disconnect()", async () => {
    vi.useFakeTimers();
    const page = fakePage();
    const adapter = createLinkedInAdapter({ page, now: fixedNow, rand: () => 0 });
    await adapter.connect(auth);
    adapter.subscribe();
    await adapter.disconnect();

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(page.pollInbox).not.toHaveBeenCalled();
    expect((await adapter.health()).status).toBe("down");
  });

  it("refuses to subscribe before connect()", () => {
    const adapter = createLinkedInAdapter({ page: fakePage() });
    expect(() => adapter.subscribe()).toThrow(AdapterError);
  });
});

describe("LinkedIn backfill()", () => {
  it("walks the inbox once, reading threads as well as unread ones", async () => {
    const page = fakePage({
      pollInbox: vi.fn(async () => [
        conversation({ conversationId: "2-a", unread: false }),
        conversation({ conversationId: "2-b", unread: true }),
      ]),
      openThread: vi.fn(async (conversationId: string) => [
        message({ conversationId, text: `from ${conversationId}` }),
      ]),
    });
    const adapter = createLinkedInAdapter({ page, now: fixedNow });
    await adapter.connect(auth);

    const items: NormalizedItem[] = [];
    for await (const item of adapter.backfill()) items.push(item);

    expect(page.pollInbox).toHaveBeenCalledTimes(1);
    expect(vi.mocked(page.openThread).mock.calls.map((c) => c[0])).toEqual(["2-a", "2-b"]);
    expect(items.map((i) => i.body)).toEqual(["from 2-a", "from 2-b"]);
  });

  it("skips a conversation entry without an id instead of calling openThread(undefined)", async () => {
    const page = fakePage({
      pollInbox: vi.fn(async () => [
        { ...conversation({ conversationId: "2-a" }) },
        {
          conversationId: "",
          title: "broken row",
          participants: [],
          lastActivityAt: "",
          unread: true,
        },
      ]),
    });
    const adapter = createLinkedInAdapter({ page, now: fixedNow });
    await adapter.connect(auth);

    const items: NormalizedItem[] = [];
    for await (const item of adapter.backfill()) items.push(item);

    expect(vi.mocked(page.openThread).mock.calls.map((c) => c[0])).toEqual(["2-a"]);
    expect(items).toHaveLength(1);
  });

  it("refuses to run before connect()", async () => {
    const adapter = createLinkedInAdapter({ page: fakePage() });
    const iterate = async (): Promise<void> => {
      for await (const _item of adapter.backfill()) {
        // no-op
      }
    };
    await expect(iterate()).rejects.toMatchObject({ kind: "fatal_protocol" });
  });
});

describe("LinkedIn send()", () => {
  it("refuses to send without an approval-gate sink, and never touches the page", async () => {
    const page = fakePage();
    const adapter = createLinkedInAdapter({ page, now: fixedNow });

    await expect(
      adapter.send({ accountId: "logan-linkedin", externalId: CONVERSATION_ID }, { text: "hi" }),
    ).rejects.toMatchObject({ kind: "fatal_unsupported" });
    // The approval gate is the point: an ungated adapter must not type into the message box.
    expect(page.sendText).not.toHaveBeenCalled();
  });

  it("hands the draft to the injected sink and returns its result", async () => {
    const page = fakePage();
    const sink = vi.fn(async () => ({
      externalId: "li:2-YWJjMTIz:1",
      sentAt: "2026-09-22T00:00:00.000Z",
    }));
    const adapter = createLinkedInAdapter({ page, sink, now: fixedNow });

    const result = await adapter.send(
      { accountId: "logan-linkedin", externalId: CONVERSATION_ID },
      { text: "hi" },
    );

    expect(sink).toHaveBeenCalledWith(
      { accountId: "logan-linkedin", externalId: CONVERSATION_ID },
      { text: "hi" },
    );
    expect(result).toEqual({ externalId: "li:2-YWJjMTIz:1", sentAt: "2026-09-22T00:00:00.000Z" });
    // The sink is the approval path (it is what wraps page.sendText); the adapter still does not call it.
    expect(page.sendText).not.toHaveBeenCalled();
  });
});
