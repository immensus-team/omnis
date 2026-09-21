import {
  type Adapter,
  type AdapterEvent,
  type NormalizedItem,
  signApproval,
} from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { handleCaptureSend, startCapture } from "../src/capture.js";
import type { CaptureConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";

const TOKEN = "bridge-token-mini";
const APPROVAL_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK: CaptureConfig = { channel: "kakaotalk", account_external_id: "kakaotalk:me" };
const NOW = "2026-09-22T09:00:00.000Z";

function logger(): Logger {
  return {
    log: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function item(n: number): NormalizedItem {
  return {
    threadExternalId: "chat-1",
    externalId: `m-${n}`,
    kind: "message",
    author: { kind: "person", id: "me" },
    body: `message ${n}`,
    attachments: [],
    sentAt: NOW,
    status: "received",
    sourceHash: `hash-${n}`,
  };
}

function emptyBackfill(): AsyncIterable<NormalizedItem> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<NormalizedItem> {
      return { next: () => Promise.resolve({ value: undefined, done: true }) };
    },
  };
}

function fakeAdapter(
  events: Array<NormalizedItem | AdapterEvent> = [],
  send: Adapter["send"] = () => Promise.resolve({ externalId: "dry-run:0", sentAt: NOW }),
): Adapter {
  return {
    id: "fake",
    channel: "kakaotalk",
    capabilities: () => ({
      read: true,
      write: false,
      realtime: true,
      history: false,
      media: false,
      markRead: false,
      typing: false,
      archive: false,
      delete: false,
    }),
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    backfill: emptyBackfill,
    subscribe: () =>
      (async function* () {
        for (const e of events) yield e;
      })(),
    send,
    health: () =>
      Promise.resolve({
        channel: "kakaotalk" as const,
        accountExternalId: "",
        status: "healthy" as const,
        lastEventAt: NOW,
      }),
  };
}

/** The notification as the hub's CaptureItemsParams sees it. */
function notifications(): Array<Record<string, unknown>> {
  return [];
}

describe("startCapture (US-C12)", () => {
  it("batches a burst into one capture.items notification that names the block's account", async () => {
    const out = notifications();
    const handle = startCapture([BLOCK], {
      makeAdapter: () => fakeAdapter([item(1), item(2), item(3)]),
      notify: (_m, params) => out.push(params),
      logger: logger(),
      batchMs: 5,
    });

    await vi.waitFor(() => expect(out).toHaveLength(1));
    expect(out[0]).toMatchObject({
      channel: "kakaotalk",
      account_external_id: "kakaotalk:me",
    });
    expect(out[0]?.events).toEqual([item(1), item(2), item(3)]);
    await handle.stop();
    // The stream ended on its own, so nothing was restarted and no extra batch appeared.
    expect(out).toHaveLength(1);
  });

  it("flushes at 200 events, so 250 leave as two notifications", async () => {
    const out = notifications();
    const events = Array.from({ length: 250 }, (_, i) => item(i));
    const handle = startCapture([BLOCK], {
      makeAdapter: () => fakeAdapter(events),
      notify: (_m, params) => out.push(params),
      logger: logger(),
      batchMs: 20,
    });

    await vi.waitFor(() => expect(out).toHaveLength(2));
    expect((out[0]?.events as unknown[]).length).toBe(200);
    expect((out[1]?.events as unknown[]).length).toBe(50);
    await handle.stop();
  });

  it("restarts a throwing adapter forever and reports disconnected to the hub", async () => {
    const out = notifications();
    const attempts = vi.fn();
    const throwing: Adapter = {
      ...fakeAdapter(),
      subscribe: () => {
        attempts();
        throw new Error("kmsg is not installed");
      },
    };
    const handle = startCapture([BLOCK], {
      makeAdapter: () => throwing,
      notify: (_m, params) => out.push(params),
      logger: logger(),
      batchMs: 5,
      restartMs: 5,
    });

    // Restarted: the second attempt is what proves it is a loop and not a one-shot failure.
    await vi.waitFor(() => expect(attempts.mock.calls.length).toBeGreaterThanOrEqual(2));
    const events = out.flatMap((p) => p.events as AdapterEvent[]);
    expect(events[0]).toEqual({
      kind: "disconnected",
      reason: "kmsg is not installed",
      at: expect.any(String),
    });
    await handle.stop();
  });

  it("stops the loops and does not notify after stop()", async () => {
    const out = notifications();
    const handle = startCapture([BLOCK], {
      makeAdapter: () => fakeAdapter([item(1), item(2)]),
      notify: (_m, params) => out.push(params),
      logger: logger(),
      batchMs: 1,
    });
    await vi.waitFor(() => expect(out).toHaveLength(1));
    await handle.stop();
    expect(handle.adapterFor("kakaotalk")).toBeDefined();
    expect(handle.adapterFor("linkedin")).toBeUndefined();
  });

  it("does not notify after stop() when a failing adapter reports back late", async () => {
    const out = notifications();
    // A connect() that stop() interrupts: the loop is parked here when stop() runs, so the failing
    // subscribe() is reached *after* stop() has flushed and cleared its timers. Before the `stopped`
    // guard on the restart path this pushed a disconnected event, which armed a fresh timer and
    // notified the hub after the agent had already shut down.
    let release = (): void => undefined;
    const gated = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = startCapture([BLOCK], {
      makeAdapter: () => ({
        ...fakeAdapter(),
        connect: () => gated,
        subscribe: () => {
          throw new Error("kmsg is not installed");
        },
      }),
      notify: (_m, params) => out.push(params),
      logger: logger(),
      batchMs: 5,
      restartMs: 5,
    });

    await handle.stop();
    release();
    await new Promise((r) => setTimeout(r, 40));
    expect(out).toEqual([]);
  });
});

describe("handleCaptureSend (US-C12)", () => {
  /** A signed request, exactly the way the hub's relay builds and signs one. */
  function params(over: Record<string, unknown> = {}): Record<string, unknown> {
    const payload = {
      channel: "kakaotalk",
      thread_external_id: "chat-1",
      text: "on my way",
      dry_run: true,
      ...over,
    };
    return {
      ...payload,
      approval_id: APPROVAL_ID,
      sig: signApproval(TOKEN, APPROVAL_ID, payload),
    };
  }

  it("refuses a signature the hub did not make with -32006", async () => {
    const send = vi.fn(() => Promise.resolve({ externalId: "kmsg:abc", sentAt: NOW }));
    const adapter = fakeAdapter([], send);
    const deps = { token: TOKEN, adapterFor: () => adapter };
    // A well-formed hex string that is not the HMAC of this payload, and a payload edited after
    // signing: neither reaches the adapter.
    await expect(handleCaptureSend(params({ sig: "a".repeat(64) }), deps)).rejects.toMatchObject({
      code: -32006,
    });
    await expect(
      handleCaptureSend({ ...params(), text: "edited after signing" }, deps),
    ).rejects.toMatchObject({ code: -32006 });
    expect(send).not.toHaveBeenCalled();
  });

  it("calls the channel's adapter with the draft and its dry_run flag", async () => {
    const send = vi.fn(() => Promise.resolve({ externalId: "kmsg:abc", sentAt: NOW }));
    const adapter = fakeAdapter([], send);
    const result = await handleCaptureSend(params(), {
      token: TOKEN,
      adapterFor: (channel) => (channel === "kakaotalk" ? adapter : undefined),
    });

    expect(send).toHaveBeenCalledWith(
      { accountId: "kakaotalk", externalId: "chat-1" },
      { text: "on my way", meta: { approval_id: APPROVAL_ID, dry_run: true } },
    );
    // A dry run never leaves the machine, whatever the adapter reports.
    expect(result).toEqual({ preview: "on my way", sent: false });
  });

  it("reports sent only when a real send was not a dry run", async () => {
    const adapter = fakeAdapter([], () => Promise.resolve({ externalId: "kmsg:abc", sentAt: NOW }));
    const result = await handleCaptureSend(params({ dry_run: false }), {
      token: TOKEN,
      adapterFor: () => adapter,
    });
    expect(result.sent).toBe(true);
  });

  it("answers RUNTIME_UNAVAILABLE for a channel this host does not capture", async () => {
    await expect(
      handleCaptureSend(params({ channel: "linkedin" }), {
        token: TOKEN,
        adapterFor: () => undefined,
      }),
    ).rejects.toMatchObject({ code: -32002 });
  });
});
