import { describe, expect, it, vi } from "vitest";
import { createTelegramAdapter } from "../src/index.js";
import type { TelegramClientLike } from "../src/index.js";

vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "session-key") }));

function fakeAuth() {
  return {
    channel: "telegram" as const,
    accountExternalId: "logan-tg",
    keychainService: "omnis.telegram.session_key",
    keychainAccount: "logan-tg",
  };
}

describe("Telegram adapter connect()/health()", () => {
  it("throws fatal_protocol when no client is injected (B-D5: real mtcute wiring deferred)", async () => {
    const adapter = createTelegramAdapter({});
    await expect(adapter.connect(fakeAuth())).rejects.toMatchObject({ kind: "fatal_protocol" });
  });

  it("reports healthy once the injected client starts", async () => {
    const client: TelegramClientLike = {
      start: vi.fn(async () => {}),
      getHistory: vi.fn(async () => []),
      onUpdate: vi.fn(() => () => {}),
      sendText: vi.fn(async () => ({ id: 1, date: 0 })),
      readHistory: vi.fn(async () => {}),
    };
    const adapter = createTelegramAdapter({ client });
    await adapter.connect(fakeAuth());
    expect((await adapter.health()).status).toBe("healthy");
    expect(client.start).toHaveBeenCalledOnce();
  });
});
