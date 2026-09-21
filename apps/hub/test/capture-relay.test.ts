import type { Logger } from "@omnis/kernel";
import { type AdapterEvent, type NormalizedItem, verifyApproval } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { type AccountRow, buildAdapters, startAdapterLoops } from "../src/adapters.js";
import {
  type CaptureRelayAdapter,
  type CaptureRelayLookup,
  captureRelayRegistry,
  intakeCaptureItems,
} from "../src/capture-relay.js";

const TOKEN = "bridge-token-mini";
const APPROVAL_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-09-22T09:00:00.000Z";

const ACCOUNTS: AccountRow[] = [
  {
    id: "acc-kakao",
    channel: "kakaotalk",
    external_id: "kakaotalk:me",
    state: "active",
    auth_ref: "omnis.capture.kakaotalk",
  },
  {
    id: "acc-linkedin",
    channel: "linkedin",
    external_id: "linkedin:logan",
    state: "active",
    auth_ref: "omnis.capture.linkedin",
  },
];

function logger(): Logger {
  return {
    log: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function item(): NormalizedItem {
  return {
    threadExternalId: "chat-1",
    externalId: "m-1",
    kind: "message",
    author: { kind: "person", id: "them" },
    body: "are we still on for 10?",
    attachments: [],
    sentAt: NOW,
    status: "received",
    sourceHash: "hash-1",
  };
}

/** The deps the hub's main.ts passes: a live bridge call and the token that signs with it. */
function relayAdapter(
  channel: "kakaotalk" | "linkedin",
  call = vi.fn(() => Promise.resolve({ preview: "p", sent: false })),
): { relay: CaptureRelayAdapter; call: ReturnType<typeof vi.fn> } {
  const registry = captureRelayRegistry();
  const make = registry.factories({ call, token: TOKEN, host: "mini" })[channel];
  if (make === undefined) throw new Error(`no capture factory for ${channel}`);
  // buildAdapters calls the factory once per account row; bridge.ts then looks the channel up.
  const created = make();
  const relay = registry.get(channel);
  if (relay === undefined || relay !== created)
    throw new Error(`the factory's ${channel} relay is not the one the intake finds`);
  return { relay, call };
}

describe("CaptureRelayAdapter (US-C12)", () => {
  it("mirrors the channel's capabilities, with write closed", () => {
    const { relay: kakao } = relayAdapter("kakaotalk");
    const { relay: linkedin } = relayAdapter("linkedin");

    expect(kakao.capabilities()).toEqual({
      read: true,
      write: false, // US-C13 opens this only once the 14-day gate passes
      realtime: true, // kmsg watch
      history: false,
      media: false,
      markRead: false,
      typing: false,
      archive: false,
      delete: false,
    });
    expect(linkedin.capabilities()).toMatchObject({
      read: true,
      write: false,
      realtime: false,
      history: true,
    });
  });

  it("carries a valid batch to the ingest sink under the account account_external_id names", async () => {
    const log = logger();
    const registry = captureRelayRegistry();
    const factories = registry.factories({ call: vi.fn(), token: TOKEN, host: "mini" });
    // The account row is what resolves account_external_id → accountId: buildAdapters binds the
    // relay to the row whose (channel, external_id) it was built for.
    const bound = await buildAdapters({ accounts: ACCOUNTS, factories, logger: log });
    expect(bound.map((b) => b.accountId)).toEqual(["acc-kakao", "acc-linkedin"]);

    const calls: Array<{ accountId: string; e: NormalizedItem | AdapterEvent }> = [];
    const loops = startAdapterLoops({
      adapters: bound,
      sink: async (accountId, e) => {
        calls.push({ accountId, e });
      },
      logger: log,
      retryDelayMs: 5,
    });

    const verdict = await intakeCaptureItems(
      { channel: "kakaotalk", account_external_id: "kakaotalk:me", events: [item()] },
      { relays: registry, logger: log },
    );

    expect(verdict).toEqual({ accepted: 1 });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.accountId).toBe("acc-kakao");
    expect(calls[0]?.e).toEqual(item());
    await loops.stop();
  });

  it("rejects a batch whose item fails the contract schema and logs it", async () => {
    const log = logger();
    const { relay } = relayAdapter("kakaotalk");
    const verdict = await intakeCaptureItems(
      {
        channel: "kakaotalk",
        account_external_id: "kakaotalk:me",
        // A NormalizedItem without author/body/sentAt/status/sourceHash, and not an AdapterEvent
        // either — the union rejects it, so the whole batch does.
        events: [{ threadExternalId: "chat-1", kind: "message", externalId: "m-1" }],
      },
      { relays: registryWith(relay), logger: log },
    );

    expect(verdict).toMatchObject({ rejected: expect.stringContaining("events.0") });
    expect(log.warn).toHaveBeenCalledWith("capture.items rejected", {
      reason: expect.stringContaining("events.0"),
    });
    // Nothing was queued: a half-ingested batch is a half thread.
    expect(await firstOrNull(relay)).toBeNull();
  });

  it("drops a batch for an account the relay does not serve", async () => {
    const log = logger();
    const { relay } = relayAdapter("kakaotalk");
    await relay.connect({
      channel: "kakaotalk",
      accountExternalId: "kakaotalk:me",
      keychainService: "omnis.capture.kakaotalk",
      keychainAccount: "omnis",
    });

    const verdict = await intakeCaptureItems(
      { channel: "kakaotalk", account_external_id: "kakaotalk:work", events: [item()] },
      { relays: registryWith(relay), logger: log },
    );

    expect(verdict).toEqual({
      rejected: "batch for account kakaotalk:work, relay serves kakaotalk:me",
    });
    expect(log.warn).toHaveBeenCalledWith("capture.items dropped", expect.anything());
  });

  it("drops a batch for a channel the hub has no relay for", async () => {
    const log = logger();
    const verdict = await intakeCaptureItems(
      { channel: "linkedin", account_external_id: "linkedin:logan", events: [item()] },
      { relays: captureRelayRegistry(), logger: log },
    );
    expect(verdict).toEqual({ rejected: "no capture relay for channel linkedin" });
  });
});

describe("CaptureRelayAdapter.send (US-C12 → US-C13)", () => {
  it("refuses a send with no approval id, and signs the payload the mini verifies", async () => {
    const { relay, call } = relayAdapter("kakaotalk");
    const thread = { accountId: "kakaotalk:me", externalId: "chat-1" };

    await expect(relay.send(thread, { text: "on my way" })).rejects.toMatchObject({ code: -32006 });
    expect(call).not.toHaveBeenCalled();

    const result = await relay.send(thread, {
      text: "on my way",
      meta: { approval_id: APPROVAL_ID, dry_run: true },
    });

    expect(result.externalId).toBe("dry-run:chat-1");
    const [host, method, params] = call.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(host).toBe("mini");
    expect(method).toBe("capture.send");
    expect(params).toMatchObject({
      channel: "kakaotalk",
      approval_id: APPROVAL_ID,
      thread_external_id: "chat-1",
      text: "on my way",
      dry_run: true,
    });
    // The mini's half (handleCaptureSend) verifies exactly this object — the two ends have to agree
    // on the signed shape or every send answers -32006.
    expect(
      verifyApproval(
        TOKEN,
        APPROVAL_ID,
        { channel: "kakaotalk", thread_external_id: "chat-1", text: "on my way", dry_run: true },
        String(params.sig),
      ),
    ).toBe(true);
  });

  it("reports the mini's answer, not its own assumption, in the SendResult", async () => {
    const call = vi.fn(() => Promise.resolve({ preview: "on my way", sent: true }));
    const { relay } = relayAdapter("kakaotalk", call);
    const result = await relay.send(
      { accountId: "kakaotalk:me", externalId: "chat-1" },
      { text: "on my way", meta: { approval_id: APPROVAL_ID, dry_run: false } },
    );
    expect(result.externalId).toBe("capture:chat-1");
  });
});

/** The intake only needs `get`, so one relay is enough of a registry. */
function registryWith(relay: CaptureRelayAdapter): CaptureRelayLookup {
  return { get: (channel) => (channel === relay.channel ? relay : undefined) };
}

/** The first event a relay yields, or null when none is waiting. */
async function firstOrNull(
  relay: CaptureRelayAdapter,
): Promise<NormalizedItem | AdapterEvent | null> {
  const iterator = relay.subscribe()[Symbol.asyncIterator]();
  const raced = await Promise.race([
    iterator.next(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 20)),
  ]);
  return raced === null || raced.done === true ? null : raced.value;
}
