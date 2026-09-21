import type { NormalizedItem } from "@omnis/protocol";
import { AdapterError } from "@omnis/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KmsgClientLike } from "../src/index.js";
import { createKakaoTalkAdapter } from "../src/index.js";

const auth = {
  channel: "kakaotalk" as const,
  accountExternalId: "logan-kakao",
  keychainService: "omnis.kakaotalk",
  keychainAccount: "logan",
};

const fixedNow = (): Date => new Date("2026-09-22T00:00:00.000Z");

function line(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chat_id: "1001",
    chat_name: "omnis launch",
    sender: "Dana Lee",
    is_me: false,
    text: "hi",
    timestamp: "2026-09-22T09:14:03+09:00",
    ...over,
  };
}

function fakeClient(over: Partial<KmsgClientLike> = {}): KmsgClientLike {
  return {
    chats: vi.fn(async () => [{ chat_id: "1001", chat_name: "omnis launch" }]),
    read: vi.fn(async () => []),
    watch: vi.fn(() => () => {}),
    send: vi.fn(async () => ({ preview: "hi", sent: false })),
    ...over,
  };
}

/** A queue that pushed nothing leaves the iterator's promise pending: flush the microtask queue and
 *  check it never settled, which is how "no duplicate item" is asserted without a timeout. The same
 *  promise is then reused for the next emission — abandoning a pending next() lets it swallow the item
 *  a later next() is waiting for, since the queue hands a pushed value to its oldest waiter. */
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

describe("KakaoTalk capabilities()", () => {
  it("keeps write off until sendEnabled() returns true (US-C13 gate)", () => {
    let enabled = false;
    const adapter = createKakaoTalkAdapter({ client: fakeClient(), sendEnabled: () => enabled });
    expect(adapter.capabilities()).toEqual({
      read: true,
      write: false,
      realtime: true,
      history: false,
      media: false,
      markRead: false,
      typing: false,
      archive: false,
      delete: false,
    });
    enabled = true;
    expect(adapter.capabilities().write).toBe(true);
    expect(adapter.capabilities().read).toBe(true);
  });
});

describe("KakaoTalk connect()", () => {
  it("refuses to come up without a kmsg client", async () => {
    const adapter = createKakaoTalkAdapter();
    await expect(adapter.connect(auth)).rejects.toBeInstanceOf(AdapterError);
    await expect(adapter.connect(auth)).rejects.toMatchObject({ kind: "fatal_protocol" });
    expect((await adapter.health()).status).toBe("down");
  });

  it("reports healthy once a client is wired", async () => {
    const adapter = createKakaoTalkAdapter({ client: fakeClient(), now: fixedNow });
    await adapter.connect(auth);
    const health = await adapter.health();
    expect(health.status).toBe("healthy");
    expect(health.channel).toBe("kakaotalk");
    expect(health.lastEventAt).toBe("2026-09-22T00:00:00.000Z");
  });
});

describe("KakaoTalk backfill()", () => {
  it("reads each chat from chats() exactly once", async () => {
    const client = fakeClient({
      chats: vi.fn(async () => [{ chat_id: "1001" }, { chat_id: "2002" }]),
      read: vi.fn(async (chatId: string) => [line({ chat_id: chatId, text: `from ${chatId}` })]),
    });
    const adapter = createKakaoTalkAdapter({ client, now: fixedNow });
    await adapter.connect(auth);

    const items: NormalizedItem[] = [];
    for await (const item of adapter.backfill()) items.push(item);

    expect(client.chats).toHaveBeenCalledTimes(1);
    expect(client.read).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.read).mock.calls.map((c) => c[0])).toEqual(["1001", "2002"]);
    expect(items.map((i) => i.body)).toEqual(["from 1001", "from 2002"]);
    expect(items.map((i) => i.threadExternalId)).toEqual(["1001", "2002"]);
  });

  it("accepts a chats() envelope and skips entries without an id", async () => {
    const client = fakeClient({
      chats: vi.fn(async () => ({
        chats: [{ chat_id: 1001 }, { chat_name: "no id" }, "3003"],
      })),
      read: vi.fn(async () => [line()]),
    });
    const adapter = createKakaoTalkAdapter({ client });
    await adapter.connect(auth);

    const items: NormalizedItem[] = [];
    for await (const item of adapter.backfill()) items.push(item);

    expect(vi.mocked(client.read).mock.calls.map((c) => c[0])).toEqual(["1001", "3003"]);
    expect(items).toHaveLength(2);
  });

  it("refuses to run before connect()", async () => {
    const adapter = createKakaoTalkAdapter();
    const iterate = async (): Promise<void> => {
      for await (const _item of adapter.backfill()) {
        // no-op
      }
    };
    await expect(iterate()).rejects.toMatchObject({ kind: "fatal_protocol" });
  });
});

describe("KakaoTalk subscribe()", () => {
  it("normalizes watched lines and drops a repeat of the same hash", async () => {
    vi.useFakeTimers();
    let onLine: ((raw: unknown) => void) | undefined;
    const client = fakeClient({
      watch: vi.fn((cb: (raw: unknown) => void) => {
        onLine = cb;
        return () => {};
      }),
    });
    const adapter = createKakaoTalkAdapter({ client, now: fixedNow, rand: () => 0 });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    // connect() queued its `connected` event before subscribe() was called — drain it first.
    expect((await iterator.next()).value).toEqual({
      kind: "connected",
      at: "2026-09-22T00:00:00.000Z",
    });

    onLine?.(line());
    onLine?.(line());
    const first = (await iterator.next()).value as NormalizedItem;
    expect(first.body).toBe("hi");
    expect(await stillPending(iterator.next())).toBe(true);

    await adapter.disconnect();
  });

  it("re-reads the open chats on the poll cadence and only emits what is new", async () => {
    vi.useFakeTimers();
    const client = fakeClient({ read: vi.fn(async () => [line()]) });
    const adapter = createKakaoTalkAdapter({ client, now: fixedNow, rand: () => 0 });
    await adapter.connect(auth);
    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    await iterator.next(); // the `connected` event queued by connect()

    // rand()=0 pins the cadence to the 5s floor of the 5-15s clamp.
    await vi.advanceTimersByTimeAsync(4_999);
    expect(client.read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(((await iterator.next()).value as NormalizedItem).body).toBe("hi");

    // The next emission, held across both polls: the repeated line must not settle it, the new line must.
    const next = iterator.next();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.read).toHaveBeenCalledTimes(2);
    expect(await stillPending(next)).toBe(true);

    // A genuinely new line does get through, so the check above is not passing vacuously.
    vi.mocked(client.read).mockResolvedValue([
      line({ text: "second", timestamp: "2026-09-23T09:14:03+09:00" }),
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(((await next).value as NormalizedItem).body).toBe("second");

    await adapter.disconnect();
  });

  it("goes degraded when the AX path breaks, without dying", async () => {
    vi.useFakeTimers();
    const client = fakeClient({
      chats: vi.fn(async () => {
        throw new Error("AXError: element not found");
      }),
    });
    const adapter = createKakaoTalkAdapter({ client, now: fixedNow, rand: () => 0 });
    await adapter.connect(auth);
    adapter.subscribe();

    await vi.advanceTimersByTimeAsync(5_000);
    const health = await adapter.health();
    expect(health.status).toBe("degraded");
    expect(health.lastError?.kind).toBe("fatal_protocol");
    expect(health.lastError?.at).toBe("2026-09-22T00:00:00.000Z");

    // Still polling: a transient fault is a health flag, not a reason to stop capturing.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.chats).toHaveBeenCalledTimes(2);

    await adapter.disconnect();
  });

  it("stops polling after disconnect()", async () => {
    vi.useFakeTimers();
    const adapter = createKakaoTalkAdapter({ client: fakeClient(), now: fixedNow, rand: () => 0 });
    await adapter.connect(auth);
    adapter.subscribe();
    await adapter.disconnect();

    await vi.advanceTimersByTimeAsync(60_000);
    expect((await adapter.health()).status).toBe("down");
  });

  it("refuses to subscribe before connect()", () => {
    const adapter = createKakaoTalkAdapter();
    expect(() => adapter.subscribe()).toThrow(AdapterError);
  });
});

describe("KakaoTalk send()", () => {
  it("throws fatal_unsupported with no client", async () => {
    const adapter = createKakaoTalkAdapter();
    await expect(
      adapter.send({ accountId: "logan-kakao", externalId: "1001" }, { text: "hi" }),
    ).rejects.toMatchObject({ kind: "fatal_unsupported" });
  });

  it("dry-runs while the send gate is closed", async () => {
    const client = fakeClient();
    const adapter = createKakaoTalkAdapter({ client, now: fixedNow, sendEnabled: () => false });

    const result = await adapter.send(
      { accountId: "logan-kakao", externalId: "1001" },
      { text: "hi" },
    );

    expect(client.send).toHaveBeenCalledWith("1001", "hi", { dryRun: true });
    expect(result.externalId.startsWith("dry-run:")).toBe(true);
    expect(result.sentAt).toBe("2026-09-22T00:00:00.000Z");
  });

  it("sends for real once sendEnabled() is true", async () => {
    const client = fakeClient({ send: vi.fn(async () => ({ preview: "hi", sent: true })) });
    const adapter = createKakaoTalkAdapter({ client, now: fixedNow, sendEnabled: () => true });

    const result = await adapter.send(
      { accountId: "logan-kakao", externalId: "1001" },
      { text: "hi" },
    );

    expect(client.send).toHaveBeenCalledWith("1001", "hi", { dryRun: false });
    expect(result.externalId.startsWith("kmsg:")).toBe(true);
  });
});
