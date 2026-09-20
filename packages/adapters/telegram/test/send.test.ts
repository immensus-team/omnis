import { describe, expect, it, vi } from "vitest";
import { createTelegramAdapter } from "../src/index.js";
import type { TelegramClientLike } from "../src/index.js";

vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "session-key") }));

describe("Telegram write-back", () => {
  it("send() only calls the injected mock sink by default, never a real client call", async () => {
    const sink = vi.fn(async () => ({ externalId: "sent-1", sentAt: "2023-11-14T00:00:00.000Z" }));
    const adapter = createTelegramAdapter({ sink });
    const result = await adapter.send({ accountId: "a", externalId: "1001" }, { text: "hi" });
    expect(sink).toHaveBeenCalledOnce();
    expect(result.externalId).toBe("sent-1");
  });

  it("markRead() calls client.readHistory()", async () => {
    const readHistory = vi.fn(async () => {});
    const client: TelegramClientLike = {
      start: vi.fn(async () => {}),
      getHistory: vi.fn(async () => []),
      onUpdate: vi.fn(() => () => {}),
      sendText: vi.fn(async () => ({ id: 1, date: 0 })),
      readHistory,
    };
    const adapter = createTelegramAdapter({ client });
    await adapter.connect({
      channel: "telegram" as const,
      accountExternalId: "a",
      keychainService: "s",
      keychainAccount: "a",
    });
    await adapter.markRead?.({ accountId: "a", externalId: "1001" });
    expect(readHistory).toHaveBeenCalledWith("1001");
  });
});
