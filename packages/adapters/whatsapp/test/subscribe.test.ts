import type { NormalizedItem } from "@omnis/protocol";
import { AdapterError } from "@omnis/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BeeperClientLike, BeeperEvent } from "../src/index.js";
import {
  POLL_MS,
  WS_RECONNECT_DEGRADE,
  WS_WINDOW_MS,
  createWhatsAppAdapter,
} from "../src/index.js";

vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "beeper-token") }));

const CHAT_ID = "!whatsapp_15550101002:ba_EvYDBBsZbRQAy3UOSWqG0LuTVkc.local-whatsapp.localhost";
const GROUP_CHAT_ID =
  "!whatsapp_120363021234567890:ba_EvYDBBsZbRQAy3UOSWqG0LuTVkc.local-whatsapp.localhost";
const TELEGRAM_CHAT_ID = "!telegram_123456789:ba_ZzQwMTIzNDU2Nzg5.local-telegram.localhost";

const auth = {
  channel: "whatsapp" as const,
  accountExternalId: "logan-whatsapp",
  keychainService: "omnis.beeper.token",
  keychainAccount: "omnis",
};

/** A clock the test owns: `now()` is injected, so the WS window is measured in fake minutes without
 *  touching vitest's timers (which drive the poll). */
function clock(start = "2026-09-22T00:00:00.000Z"): {
  now: () => Date;
  advance: (ms: number) => void;
} {
  let current = new Date(start);
  return {
    now: () => current,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

function dmChat(): Record<string, unknown> {
  return {
    id: CHAT_ID,
    accountID: "local-whatsapp_ba_EvYDBBsZbRQAy3UOSWqG0LuTVkc",
    network: "whatsapp",
    title: "Dana Lee",
    type: "single",
    unreadCount: 1,
    participants: {
      hasMore: false,
      total: 2,
      items: [
        {
          id: "@ba_EvYDBBsZbRQAy3UOSWqG0LuTVkc:local-whatsapp.localhost",
          fullName: "Logan Kim",
          isSelf: true,
        },
        { id: "@15550101002:local-whatsapp.localhost", fullName: "Dana Lee" },
      ],
    },
  };
}

function groupChat(): Record<string, unknown> {
  return {
    id: GROUP_CHAT_ID,
    accountID: "local-whatsapp_ba_EvYDBBsZbRQAy3UOSWqG0LuTVkc",
    network: "whatsapp",
    title: "Trip planning",
    type: "group",
    unreadCount: 3,
    participants: {
      hasMore: false,
      total: 2,
      items: [{ id: "@15550109999:local-whatsapp.localhost", fullName: "Sam Okafor" }],
    },
  };
}

function telegramChat(): Record<string, unknown> {
  return {
    id: TELEGRAM_CHAT_ID,
    accountID: "local-telegram_ba_ZzQwMTIzNDU2Nzg5",
    network: "telegram",
    title: "Dana Lee",
    type: "single",
    unreadCount: 0,
    participants: {
      hasMore: false,
      total: 1,
      items: [{ id: "@telegram_123456789:local-telegram.localhost", fullName: "Dana Lee" }],
    },
  };
}

function message(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "1343993",
    accountID: "local-whatsapp_ba_EvYDBBsZbRQAy3UOSWqG0LuTVkc",
    chatID: CHAT_ID,
    senderID: "@15550101002:local-whatsapp.localhost",
    senderName: "Dana Lee",
    sortKey: "455171049984",
    timestamp: "2026-09-22T09:14:03.621Z",
    type: "TEXT",
    text: "hi",
    isDeleted: false,
    attachments: [],
    ...over,
  };
}

interface FakeClient {
  client: BeeperClientLike;
  emit: (event: BeeperEvent) => void;
  /** The client reports a dropped WS; re-dialing is the client's own business (BeeperClientLike has no
   *  connect method), so this is the whole of what the adapter sees. */
  closeWs: (reason: string) => void;
  stopped: () => boolean;
  /** How many onEvent() registrations were made, and how many of them the adapter stopped. A
   *  re-subscribe that does not stop the one it replaces leaves the old callback live. */
  wsRegistrations: () => number;
  wsStops: () => number;
}

function fakeClient(over: Partial<BeeperClientLike> = {}): FakeClient {
  let onEvent: ((event: BeeperEvent) => void) | undefined;
  let onClose: ((reason: string) => void) | undefined;
  let registrations = 0;
  let stops = 0;
  const client: BeeperClientLike = {
    listChats: vi.fn(async () => [dmChat(), groupChat(), telegramChat()]),
    listMessages: vi.fn(async () => []),
    sendMessage: vi.fn(async () => ({ id: "sent-1", timestamp: "2026-09-22T00:00:00.000Z" })),
    markRead: vi.fn(async () => {}),
    onEvent: vi.fn((cb: (event: BeeperEvent) => void, close: (reason: string) => void) => {
      onEvent = cb;
      onClose = close;
      registrations += 1;
      return () => {
        stops += 1;
      };
    }),
    ...over,
  };
  return {
    client,
    emit: (event) => onEvent?.(event),
    closeWs: (reason) => onClose?.(reason),
    stopped: () => stops > 0,
    wsRegistrations: () => registrations,
    wsStops: () => stops,
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

describe("WhatsApp capabilities()", () => {
  it("declares a WS + poll reader with an approval-only writer", () => {
    const adapter = createWhatsAppAdapter({ client: fakeClient().client });
    expect(adapter.id).toBe("whatsapp");
    expect(adapter.channel).toBe("whatsapp");
    expect(adapter.capabilities()).toEqual({
      read: true,
      // No approval-gate sink, no write: the sink is what the approval path injects (Task 24).
      write: false,
      realtime: true, // the Beeper Desktop API WS
      history: true, // Beeper holds history locally; REST backfill
      media: true, // proxied through the Beeper Assets API
      markRead: true, // POST /v1/chats/{chatID}/read
      typing: false,
      archive: false,
      delete: false, // a Beeper deletion is not a hard delete (A1 §2.6)
    });
  });

  it("opens write once an approval-gate sink is wired", () => {
    const adapter = createWhatsAppAdapter({
      client: fakeClient().client,
      sink: async () => ({ externalId: "wa:sent", sentAt: "2026-09-22T00:00:00.000Z" }),
    });
    expect(adapter.capabilities().write).toBe(true);
  });
});

describe("WhatsApp connect()/disconnect()", () => {
  it("refuses to come up without a client", async () => {
    const adapter = createWhatsAppAdapter();
    await expect(adapter.connect(auth)).rejects.toBeInstanceOf(AdapterError);
    await expect(adapter.connect(auth)).rejects.toMatchObject({ kind: "fatal_protocol" });
    expect((await adapter.health()).status).toBe("down");
  });

  it("reports healthy once a client is wired, and warms the chat cache", async () => {
    const fake = fakeClient();
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);

    expect(fake.client.listChats).toHaveBeenCalledOnce();
    const health = await adapter.health();
    expect(health.status).toBe("healthy");
    expect(health.channel).toBe("whatsapp");
    // The Beeper Desktop API has no per-account concept omnis owns — the token is the account.
    expect(health.accountExternalId).toBe("");
    expect(health.lastEventAt).toBe("2026-09-22T00:00:00.000Z");
    expect(health.lastError).toBeUndefined();
  });

  it("still comes up, degraded, when the chat warm-up fails", async () => {
    const fake = fakeClient({
      listChats: vi.fn(async () => {
        throw { status: 500, message: "Beeper is restarting" };
      }),
    });
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);

    // Capture is not dead — the WS is up and the next poll re-lists — so this is `degraded`, not `down`.
    const health = await adapter.health();
    expect(health.status).toBe("degraded");
    expect(health.lastError?.kind).toBe("retryable_network");
  });

  it("marks itself down and stops both paths on disconnect()", async () => {
    vi.useFakeTimers();
    const fake = fakeClient();
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    await iterator.next();

    await adapter.disconnect();
    expect(fake.stopped()).toBe(true);
    expect((await adapter.health()).status).toBe("down");

    const callsAfterDisconnect = vi.mocked(fake.client.listChats).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(vi.mocked(fake.client.listChats).mock.calls.length).toBe(callsAfterDisconnect);
  });

  // A failure belongs to the session that hit it. Once a new session is up — connect() re-lists the
  // chats and succeeds — reporting the previous session's error would show the user a stale fault.
  it("drops a previous session's failure when a new session comes up", async () => {
    vi.useFakeTimers();
    const fake = fakeClient();
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);

    vi.mocked(fake.client.listChats).mockRejectedValueOnce({
      status: 500,
      message: "Beeper is restarting",
    });
    adapter.subscribe();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect((await adapter.health()).status).toBe("down");

    await adapter.disconnect();
    // The fresh session's warm-up succeeds, and there is no error left over from before it.
    await adapter.connect(auth);
    const health = await adapter.health();
    expect(health.status).toBe("healthy");
    expect(health.lastError).toBeUndefined();

    await adapter.disconnect();
  });
});

describe("WhatsApp subscribe()", () => {
  it("carries WS events onto the queue", async () => {
    const fake = fakeClient();
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    // connect() queued its `connected` event before subscribe() was called — drain it first.
    expect((await iterator.next()).value).toEqual({
      kind: "connected",
      at: "2026-09-22T00:00:00.000Z",
    });

    fake.emit({ type: "message.upserted", data: message() });
    const item = (await iterator.next()).value as NormalizedItem;
    expect(item.body).toBe("hi");
    expect(item.threadExternalId).toBe(CHAT_ID);
    expect(item.threadMeta?.title).toBe("Dana Lee");

    await adapter.disconnect();
  });

  // The real `message.upserted` frame carries `entries` — an array — so a client that forwards the
  // frame's list rather than one extracted payload has to be understood, not silently dropped. A drop
  // here is invisible: the WS is the only realtime path and the poll would look like it was merely late.
  it("carries every entry when the frame hands over the entries array", async () => {
    const fake = fakeClient();
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    await iterator.next();

    fake.emit({
      type: "message.upserted",
      data: [message(), message({ id: "1343994", text: "and one more" })],
    });

    const first = (await iterator.next()).value as NormalizedItem;
    const second = (await iterator.next()).value as NormalizedItem;
    expect([first.externalId, second.externalId]).toEqual(["1343993", "1343994"]);
    expect(second.body).toBe("and one more");

    await adapter.disconnect();
  });

  it("polls the REST API on the 1-minute cadence in parallel with the WS", async () => {
    vi.useFakeTimers();
    const fake = fakeClient({ listMessages: vi.fn(async () => [message()]) });
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    await iterator.next(); // the `connected` event

    const beforePoll = vi.mocked(fake.client.listMessages).mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(vi.mocked(fake.client.listMessages).mock.calls.length).toBe(beforePoll);

    await vi.advanceTimersByTimeAsync(1);
    // Only the two WhatsApp chats are read: the Telegram chat Beeper also carries is skipped.
    expect(vi.mocked(fake.client.listMessages).mock.calls.map((call) => call[0])).toEqual([
      CHAT_ID,
      GROUP_CHAT_ID,
    ]);
    expect(((await iterator.next()).value as NormalizedItem).externalId).toBe("1343993");

    await adapter.disconnect();
  });

  // A1 §2.6: the WS is experimental, so the poll runs alongside it — which means every message the WS
  // already delivered is handed over a second time. sourceHash is what makes the second a no-op.
  it("emits a message once when the WS and the poll both deliver it", async () => {
    vi.useFakeTimers();
    const fake = fakeClient({ listMessages: vi.fn(async () => [message()]) });
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    await iterator.next();

    fake.emit({ type: "message.upserted", data: message() });
    expect(((await iterator.next()).value as NormalizedItem).externalId).toBe("1343993");

    const next = iterator.next();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(vi.mocked(fake.client.listMessages).mock.calls.length).toBeGreaterThan(0);
    expect(await stillPending(next)).toBe(true);

    await adapter.disconnect();
  });

  // apps/hub/src/adapters.ts pump() calls subscribe() again after a sink failure, so in production this
  // is not once-per-adapter. A second call has to _replace_ the first WS registration and poll chain: if
  // it merely adds, every retry leaves the old WS callback live and stacks another 60-second poller
  // against Beeper's REST API.
  it("replaces the WS registration and the poll chain when subscribe() is called again", async () => {
    vi.useFakeTimers();
    const fake = fakeClient({ listMessages: vi.fn(async () => []) });
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);

    adapter.subscribe();
    adapter.subscribe();
    expect(fake.wsRegistrations()).toBe(2);
    // The registration the first call made was stopped by the second, not left firing.
    expect(fake.wsStops()).toBe(1);

    // One poll pass over the two WhatsApp chats — not the two a stacked chain would produce.
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(vi.mocked(fake.client.listMessages).mock.calls).toHaveLength(2);

    await adapter.disconnect();
  });

  // The harder half of the same problem: clearing the timer only stops a _scheduled_ pass. If the
  // re-subscribe lands while a pass is in flight, that pass's own re-schedule would still start a second
  // chain — and would overwrite the timer handle, so disconnect() could no longer stop it.
  it("does not leave a duplicate chain when a re-subscribe lands mid-poll", async () => {
    vi.useFakeTimers();
    // Every listMessages call waits on one gate the test opens, so a pass can be held mid-flight.
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const fake = fakeClient({
      listMessages: vi.fn(async () => {
        await gate;
        return [];
      }),
    });
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    adapter.subscribe();

    await vi.advanceTimersByTimeAsync(POLL_MS); // the first pass starts and blocks on the gate
    // One call so far: the pass is genuinely in flight, past the point where clearing a timer helps.
    expect(vi.mocked(fake.client.listMessages).mock.calls).toHaveLength(1);
    adapter.subscribe(); // the hub's retry, arriving while that pass is still open
    open(); // the held pass finishes now — and must not schedule a chain of its own

    await vi.advanceTimersByTimeAsync(POLL_MS);
    // The held pass stops at the chat it was already inside (1), and the replacement chain runs one pass
    // over the two WhatsApp chats (2). A second chain surviving would make it five, and the held pass
    // walking to the end of the list instead of stopping would make it four.
    expect(vi.mocked(fake.client.listMessages).mock.calls).toHaveLength(3);

    await adapter.disconnect();
  });

  // The other half of "disconnect() stops reading": clearing the timer only reaches a pass that has not
  // started. A pass already inside the chat list keeps walking it and keeps emitting, so the consumer
  // that disconnect() was told to stop gets items after it is gone.
  it("stops a pass in flight when disconnect() lands mid-pass", async () => {
    vi.useFakeTimers();
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const fake = fakeClient({
      listMessages: vi.fn(async () => {
        await gate;
        return [message()];
      }),
    });
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    await iterator.next(); // the `connected` event

    await vi.advanceTimersByTimeAsync(POLL_MS); // the pass starts and blocks on the gate
    expect(vi.mocked(fake.client.listMessages).mock.calls).toHaveLength(1);

    void adapter.disconnect(); // its whole body runs synchronously, up to the await it does not have
    open(); // the held read now comes back with a message the pass must not deliver
    await vi.advanceTimersByTimeAsync(POLL_MS);

    // The second chat is never read, and the message the first read returned is never emitted: without
    // the re-check inside the pass both happen, and this is 2 calls with an item on the queue.
    expect(vi.mocked(fake.client.listMessages).mock.calls).toHaveLength(1);
    expect(await stillPending(iterator.next())).toBe(true);
  });

  // "chat.upserted → threadMeta" (backlog US-C11): a chat the adapter has not listed is learned from the
  // event itself, which is what gives the very next message of that chat its real title and thread kind.
  it("learns a chat from chat.upserted, so the next WS message carries its threadMeta", async () => {
    vi.useFakeTimers();
    // Neither the warm-up nor the poll ever sees the group, so it can only have come from the event.
    const fake = fakeClient({ listChats: vi.fn(async () => [dmChat()]) });
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    await iterator.next();

    fake.emit({ type: "chat.upserted", data: groupChat() });
    fake.emit({
      type: "message.upserted",
      data: message({ id: "2200771", chatID: GROUP_CHAT_ID, text: "Booked the 14:20 ferry." }),
    });

    const item = (await iterator.next()).value as NormalizedItem;
    expect(item.threadExternalId).toBe(GROUP_CHAT_ID);
    expect(item.threadMeta?.kind).toBe("group");
    expect(item.threadMeta?.title).toBe("Trip planning");
    expect(item.threadMeta?.participants).toHaveLength(1);

    await adapter.disconnect();
  });

  it("forgets a deleted chat, falling back to the sender for threadMeta", async () => {
    vi.useFakeTimers();
    const fake = fakeClient();
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    await iterator.next();

    // `chat.deleted` is an IDs-only frame, so the cache is emptied from `ids` rather than a payload.
    fake.emit({ type: "chat.deleted", data: { ids: [CHAT_ID] } });
    fake.emit({ type: "message.upserted", data: message({ id: "1344200" }) });

    const item = (await iterator.next()).value as NormalizedItem;
    expect(item.threadExternalId).toBe(CHAT_ID);
    expect(item.threadMeta?.title).toBeNull();
    expect(item.threadMeta?.kind).toBe("dm");
    expect(item.threadMeta?.participants).toEqual([
      { externalId: "@15550101002:local-whatsapp.localhost", displayName: "Dana Lee" },
    ]);

    await adapter.disconnect();
  });

  it("emits nothing for a chat that is not on the WhatsApp network", async () => {
    vi.useFakeTimers();
    const fake = fakeClient();
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    await iterator.next();

    const next = iterator.next();
    // A Beeper account for one of the other 11+ networks (master §8: v1 takes WhatsApp only), both as a
    // chat and as a message arriving over the same WS.
    fake.emit({ type: "chat.upserted", data: telegramChat() });
    fake.emit({
      type: "message.upserted",
      data: message({
        id: "m_9911",
        accountID: "local-telegram_ba_ZzQwMTIzNDU2Nzg5",
        chatID: TELEGRAM_CHAT_ID,
      }),
    });
    expect(await stillPending(next)).toBe(true);

    await adapter.disconnect();
  });

  it("drops a Beeper deletion instead of turning it into an empty row", async () => {
    vi.useFakeTimers();
    const fake = fakeClient();
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    await iterator.next();

    const next = iterator.next();
    // The real frame is IDs-only, and the deleted id was never emitted in the first place — omnis keeps
    // the stored item (no hard delete) and simply writes no new timeline entry.
    fake.emit({ type: "message.deleted", data: { chatID: CHAT_ID, ids: ["1343993"] } });
    fake.emit({
      type: "message.upserted",
      data: message({ isDeleted: true, text: "" }),
    });
    expect(await stillPending(next)).toBe(true);

    await adapter.disconnect();
  });

  it("reports down when the poll fails and clears it on the next good poll", async () => {
    vi.useFakeTimers();
    const fake = fakeClient();
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    // connect() warms the chat cache with its own listChats, so the failing call is armed after it —
    // this is the poll failing, not the warm-up.
    vi.mocked(fake.client.listChats).mockRejectedValueOnce({
      status: 401,
      message: "Invalid or expired access token",
    });
    adapter.subscribe();

    await vi.advanceTimersByTimeAsync(POLL_MS);
    const health = await adapter.health();
    expect(health.status).toBe("down");
    expect(health.lastError?.kind).toBe("auth_expired");
    expect(health.lastError?.at).toBe("2026-09-22T00:00:00.000Z");

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect((await adapter.health()).status).toBe("healthy");

    await adapter.disconnect();
  });
});

// A1-D3: "switch to the whatsmeow sidecar if send via Beeper fails, or if the WS reconnects 3 or more
// times during a 30-minute observation." These three cases pin the window's edges.
describe("WhatsApp WS stability (A1-D3)", () => {
  async function started(): Promise<{
    adapter: ReturnType<typeof createWhatsAppAdapter>;
    fake: FakeClient;
    time: { now: () => Date; advance: (ms: number) => void };
  }> {
    const fake = fakeClient();
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);
    adapter.subscribe();
    return { adapter, fake, time };
  }

  it("stays healthy through two closes in the window", async () => {
    const { adapter, fake, time } = await started();

    fake.closeWs("socket closed");
    time.advance(10 * 60_000);
    fake.closeWs("socket closed");
    time.advance(10 * 60_000);

    const health = await adapter.health();
    expect(health.status).toBe("healthy");
    expect(health.lastError).toBeUndefined();

    await adapter.disconnect();
  });

  it("goes degraded on the third close inside 30 minutes, with the A1-D3 fallback signal", async () => {
    const { adapter, fake, time } = await started();

    for (let i = 0; i < WS_RECONNECT_DEGRADE; i += 1) {
      fake.closeWs("socket closed");
      time.advance(10 * 60_000);
    }

    const health = await adapter.health();
    expect(health.status).toBe("degraded");
    expect(health.lastError?.kind).toBe("retryable_network");
    expect(health.lastError?.message).toBe("ws_unstable: consider whatsmeow fallback (A1-D3)");

    await adapter.disconnect();
  });

  it("forgets a close that has aged out of the window", async () => {
    const { adapter, fake, time } = await started();

    fake.closeWs("socket closed");
    time.advance(WS_WINDOW_MS + 60_000); // the first close is now outside the 30-minute observation
    fake.closeWs("socket closed");
    time.advance(10 * 60_000);
    fake.closeWs("socket closed");

    // Only two closes sit in the window, so the whatsmeow switch has not been earned yet.
    expect((await adapter.health()).status).toBe("healthy");

    await adapter.disconnect();
  });
});

describe("WhatsApp backfill()", () => {
  it("yields the WhatsApp chats' messages and reports progress", async () => {
    const fake = fakeClient({ listMessages: vi.fn(async () => [message()]) });
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);

    const items: NormalizedItem[] = [];
    for await (const item of adapter.backfill()) items.push(item);
    expect(items.map((item) => item.externalId)).toEqual(["1343993"]);
    expect(vi.mocked(fake.client.listMessages).mock.calls.map((call) => call[0])).toEqual([
      CHAT_ID,
      GROUP_CHAT_ID,
    ]);
  });

  it("refuses to run before connect()", async () => {
    const adapter = createWhatsAppAdapter({ client: fakeClient().client });
    const drain = async (): Promise<void> => {
      for await (const _ of adapter.backfill()) {
        // no items expected — the call must throw before yielding
      }
    };
    await expect(drain()).rejects.toMatchObject({ kind: "fatal_protocol" });
  });
});

describe("WhatsApp write-back", () => {
  it("never calls client.sendMessage — only the injected sink", async () => {
    const fake = fakeClient();
    const time = clock();
    const sink = vi.fn(async () => ({
      externalId: "wa:sent-1",
      sentAt: "2026-09-22T00:00:00.000Z",
    }));
    const adapter = createWhatsAppAdapter({ client: fake.client, sink, now: time.now });
    await adapter.connect(auth);

    const result = await adapter.send(
      { accountId: "acc-1", externalId: CHAT_ID },
      { text: "on my way" },
    );
    expect(result).toEqual({ externalId: "wa:sent-1", sentAt: "2026-09-22T00:00:00.000Z" });
    expect(sink).toHaveBeenCalledOnce();
    // A1-② leaves WhatsApp send success UNVERIFIED until the Phase 0 spike — the adapter must not reach
    // the network on its own, even with a real client wired.
    expect(fake.client.sendMessage).not.toHaveBeenCalled();
  });

  it("refuses to send with no approval-gate sink", async () => {
    const adapter = createWhatsAppAdapter({ client: fakeClient().client });
    await expect(
      adapter.send({ accountId: "acc-1", externalId: CHAT_ID }, { text: "hi" }),
    ).rejects.toMatchObject({ kind: "fatal_unsupported" });
  });

  it("marks a thread read through the client", async () => {
    const fake = fakeClient();
    const time = clock();
    const adapter = createWhatsAppAdapter({ client: fake.client, now: time.now });
    await adapter.connect(auth);

    await adapter.markRead?.({ accountId: "acc-1", externalId: CHAT_ID });
    expect(fake.client.markRead).toHaveBeenCalledWith(CHAT_ID);
  });
});
