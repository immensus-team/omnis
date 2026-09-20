import type { Adapter, AdapterEvent, AuthRef, NormalizedItem } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  type AccountRow,
  type AdapterFactories,
  adaptersByChannel,
  buildAdapters,
  startAdapterLoops,
} from "./adapters.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function fakeAdapter(over: Partial<Adapter> = {}): Adapter {
  return {
    id: "fake",
    channel: "gmail",
    capabilities: () =>
      ({
        read: true,
        write: false,
        realtime: false,
        history: false,
        media: false,
        markRead: false,
        typing: false,
      }) as never,
    connect: vi.fn(async (_auth: AuthRef) => {}),
    backfill: async function* () {},
    subscribe: async function* () {},
    send: vi.fn(async () => ({ externalId: "x", sentAt: new Date().toISOString() })),
    health: vi.fn(async () => ({
      channel: "gmail",
      accountExternalId: "me",
      status: "healthy",
      lastEventAt: null,
    })) as never,
    ...over,
  } as Adapter;
}

const accounts: AccountRow[] = [
  {
    id: "a1",
    channel: "gmail",
    external_id: "me@example.com",
    state: "active",
    auth_ref: "omnis.gmail.refresh.me@example.com",
  },
  {
    id: "a2",
    channel: "telegram",
    external_id: "+8210",
    state: "broken",
    auth_ref: "omnis.telegram.session_key",
  },
  {
    id: "a3",
    channel: "whatsapp",
    external_id: "w1",
    state: "active",
    auth_ref: "omnis.whatsapp.x",
  },
  { id: "a4", channel: "outlook", external_id: "me@corp.example", state: "active", auth_ref: null },
];

describe("buildAdapters", () => {
  it("returns one binding per active account that has a factory and a secret", async () => {
    const gmail = fakeAdapter();
    const factories: AdapterFactories = { gmail: () => gmail };
    const built = await buildAdapters({ accounts, factories, logger });
    expect(built.map((b) => b.accountId)).toEqual(["a1"]);
    expect(built[0]?.adapter).toBe(gmail);
    expect(built[0]?.channel).toBe("gmail");
  });

  it("keys the hub-facing map by channel, which is what archive.ts (US-A36) looks up", async () => {
    const gmail = fakeAdapter();
    const factories: AdapterFactories = { gmail: () => gmail };
    const built = await buildAdapters({ accounts, factories, logger });
    const byChannel = adaptersByChannel(built);
    expect([...byChannel.keys()]).toEqual(["gmail"]);
    expect(byChannel.get("gmail")).toBe(gmail);
    // Not the account id — archive.ts calls adapters.get(row.channel).
    expect(byChannel.get("a1")).toBeUndefined();
  });

  it("calls connect() with the AuthRef built from the account row — never with a secret value", async () => {
    const connect = vi.fn(async () => {});
    const factories: AdapterFactories = { gmail: () => fakeAdapter({ connect }) };
    await buildAdapters({ accounts, factories, logger });
    expect(connect).toHaveBeenCalledWith({
      channel: "gmail",
      accountExternalId: "me@example.com",
      keychainService: "omnis.gmail.refresh.me@example.com",
      keychainAccount: "281932556+jinhologankim@users.noreply.github.com",
    });
  });

  it("skips non-active accounts, channels with no factory, and accounts with no secret — and says which", async () => {
    const factories: AdapterFactories = {
      gmail: () => fakeAdapter(),
      outlook: () => fakeAdapter(),
    };
    const built = await buildAdapters({ accounts, factories, logger });
    expect(built.map((b) => b.accountId)).toEqual(["a1"]); // a2 broken, a3 no factory, a4 no auth_ref
    expect(logger.warn).toHaveBeenCalled();
  });

  it("boots cleanly with zero accounts and zero factories", async () => {
    const built = await buildAdapters({ accounts: [], factories: {}, logger });
    expect(built).toEqual([]);
    expect(adaptersByChannel(built).size).toBe(0);
  });

  // If the hub fails to start because one account could not connect, every other channel dies with it.
  it("keeps going when one connect() throws, and reports that account as broken", async () => {
    const recordAdapterHealth = vi.fn(async () => {});
    const factories: AdapterFactories = {
      gmail: () => fakeAdapter({ connect: vi.fn(async () => {}) }),
      outlook: () =>
        fakeAdapter({
          connect: vi.fn(async () => {
            throw new Error("auth revoked");
          }),
        }),
    };
    const other: AccountRow = {
      id: "a4",
      channel: "outlook",
      external_id: "me@corp.example",
      state: "active",
      auth_ref: "omnis.outlook.me@corp.example",
    };
    const built = await buildAdapters({
      accounts: [...accounts, other],
      factories,
      logger,
      recordAdapterHealth,
    });
    expect(built.map((b) => b.accountId)).toEqual(["a1"]);
    expect(recordAdapterHealth).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "a4", channel: "outlook", status: "down" }),
    );
  });

  // Reporting health is best effort: a failing report (ntfy down, DB blip) must not take the hub down.
  it("does not let a throwing health report abort startup", async () => {
    const built = await buildAdapters({
      accounts: [accounts[3] as AccountRow], // a4: active outlook with a secret
      factories: {
        outlook: () =>
          fakeAdapter({
            connect: vi.fn(async () => {
              throw new Error("x");
            }),
          }),
      },
      logger,
      recordAdapterHealth: vi.fn(async () => {
        throw new Error("ntfy unreachable");
      }),
    });
    expect(built).toEqual([]);
  });
});

describe("startAdapterLoops", () => {
  it("drains subscribe() into the sink and stops cleanly", async () => {
    const events: (NormalizedItem | AdapterEvent)[] = [
      { kind: "health", channel: "gmail", status: "healthy" } as unknown as AdapterEvent,
    ];
    const adapter = fakeAdapter({
      subscribe: async function* () {
        yield* events;
      },
    });
    const sink = vi.fn(async () => {});
    const loops = startAdapterLoops({
      adapters: [{ accountId: "a1", channel: "gmail", adapter }],
      sink,
      logger,
    });
    await loops.drained();
    expect(sink).toHaveBeenCalledWith("a1", events[0]);
    await loops.stop();
  });

  it("a throwing subscribe() reports health and does not reject stop()", async () => {
    const recordAdapterHealth = vi.fn(async () => {});
    const adapter = fakeAdapter({
      // biome-ignore lint/correctness/useYield: a stream that throws before its first event.
      subscribe: async function* () {
        throw new Error("socket closed");
      },
    });
    const loops = startAdapterLoops({
      adapters: [{ accountId: "a1", channel: "gmail", adapter }],
      sink: vi.fn(async () => {}),
      logger,
      recordAdapterHealth,
      retryDelayMs: 0,
      maxRetries: 0,
    });
    await loops.drained();
    expect(recordAdapterHealth).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "a1", status: "down" }),
    );
    await expect(loops.stop()).resolves.toBeUndefined();
  });

  it("survives a throwing health report inside the retry path", async () => {
    const adapter = fakeAdapter({
      // biome-ignore lint/correctness/useYield: a stream that throws before its first event.
      subscribe: async function* () {
        throw new Error("socket closed");
      },
    });
    const loops = startAdapterLoops({
      adapters: [{ accountId: "a1", channel: "gmail", adapter }],
      sink: vi.fn(async () => {}),
      logger,
      recordAdapterHealth: vi.fn(async () => {
        throw new Error("ntfy unreachable");
      }),
      retryDelayMs: 0,
      maxRetries: 1,
    });
    await loops.drained();
    await expect(loops.stop()).resolves.toBeUndefined();
  });
});
