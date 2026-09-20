import { describe, expect, it, vi } from "vitest";
import { BACKFILL_MAX_ITEMS, createTelegramAdapter } from "../src/index.js";
import type { TelegramClientLike } from "../src/index.js";

vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "session-key") }));

function fakeAuth() {
  return {
    channel: "telegram" as const,
    accountExternalId: "logan-tg",
    keychainService: "s",
    keychainAccount: "a",
  };
}

describe("Telegram backfill()", () => {
  it("caps at BACKFILL_MAX_ITEMS even if the client returns more", async () => {
    const raws = Array.from({ length: BACKFILL_MAX_ITEMS + 10 }, (_, i) => ({
      id: i,
      chat: { id: 1, type: "private" },
      sender: { id: 9, firstName: "A" },
      text: "x",
      date: 1,
    }));
    const client: TelegramClientLike = {
      start: vi.fn(async () => {}),
      getHistory: vi.fn(async () => raws),
      onUpdate: vi.fn(() => () => {}),
      sendText: vi.fn(async () => ({ id: 1, date: 0 })),
      readHistory: vi.fn(async () => {}),
    };
    const adapter = createTelegramAdapter({ client });
    await adapter.connect(fakeAuth());
    const items = [];
    for await (const item of adapter.backfill()) items.push(item);
    expect(items).toHaveLength(BACKFILL_MAX_ITEMS);
  });
});

describe("Telegram subscribe()", () => {
  it("normalizes updates pushed via onUpdate()", async () => {
    let handler: ((raw: unknown) => void) | undefined;
    const client: TelegramClientLike = {
      start: vi.fn(async () => {}),
      getHistory: vi.fn(async () => []),
      onUpdate: vi.fn((cb) => {
        handler = cb;
        return () => {};
      }),
      sendText: vi.fn(async () => ({ id: 1, date: 0 })),
      readHistory: vi.fn(async () => {}),
    };
    const adapter = createTelegramAdapter({ client });
    await adapter.connect(fakeAuth());
    const it1 = adapter.subscribe()[Symbol.asyncIterator]();
    handler?.({
      id: 9,
      chat: { id: 1, type: "private" },
      sender: { id: 9, firstName: "A" },
      text: "hi",
      date: 1,
    });
    // connect() already pushed a "connected" AdapterEvent onto the shared queue (Task 8, src/index.ts
    // connect()) before subscribe() attaches — drain it first, matching how a real consumer
    // distinguishes NormalizedItem (has externalId) from AdapterEvent (kind: "connected"/...).
    await it1.next();
    const second = await it1.next();
    expect((second.value as { externalId?: string }).externalId).toBe("9");
  });
});
