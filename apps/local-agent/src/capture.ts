// US-C12: the capture sidecar. KakaoTalk and LinkedIn run inside this agent, on the mini's GUI
// session (C-D3: kmsg needs Accessibility, LinkedIn needs a logged-in browser profile), and their
// normalized items reach the hub as `capture.items` notifications over the existing bridge socket.
// The hub's CaptureRelayAdapter then makes them look like any other channel's items.
import {
  type Adapter,
  type AdapterEvent,
  type AuthRef,
  BRIDGE_ERRORS,
  BridgeError,
  CaptureSendParams,
  type NormalizedItem,
  verifyApproval,
} from "@omnis/protocol";
import type { CaptureChannel, CaptureConfig } from "./config.js";
import type { Logger } from "./logger.js";

/** CaptureItemsParams caps a batch at 200 events; the sidecar flushes at the same ceiling, so a
 *  burst is split into valid notifications instead of being rejected whole by the hub's zod parse. */
export const BATCH_MAX_EVENTS = 200;
const DEFAULT_BATCH_MS = 1_000;
/** The plan's restart cadence: an adapter that cannot subscribe is retried forever, every 30s. */
const DEFAULT_RESTART_MS = 30_000;
/** The preview is what the approval card shows (US-C13); the draft is already capped at 4000. */
const PREVIEW_MAX_CHARS = 400;

export type CapturedEvent = NormalizedItem | AdapterEvent;

export interface CaptureDeps {
  /** One adapter per channel, built with no client in W1 — every real client is a W2 story (US-C20,
   *  US-C25), so `subscribe()` idles or throws until then. */
  makeAdapter(channel: CaptureChannel): Adapter;
  /** A2 §3.3 bridge notification. main.ts routes it through hub-sink.ts's pattern: the socket when
   *  it is open, the outbox when it is not. */
  notify(method: "capture.items", params: Record<string, unknown>): void;
  logger: Logger;
  /** Deviation from the plan's fixed 1s/30s: injectable so tests do not sleep. */
  batchMs?: number;
  restartMs?: number;
}

export interface CaptureHandle {
  stop(): Promise<void>;
  /** `capture.send`'s target. Undefined for a channel with no `[[capture]]` block. */
  adapterFor(channel: string): Adapter | undefined;
}

/** A2 §5.1: the hub signs the capture draft with the bridge token (both ends already hold it) and
 *  this is the mini's half of the check — the same shape `runDelegation` verifies for a brief. */
export interface CaptureSendDeps {
  token: string;
  adapterFor(channel: string): Adapter | undefined;
}

export async function handleCaptureSend(
  params: unknown,
  deps: CaptureSendDeps,
): Promise<{ preview: string; sent: boolean }> {
  const p = CaptureSendParams.parse(params);
  // The signed object is exactly what the hub put in the signature, no more: the approval id travels
  // alongside it because it is the HMAC's own key material.
  const payload = {
    channel: p.channel,
    thread_external_id: p.thread_external_id,
    text: p.text,
    dry_run: p.dry_run,
  };
  if (!verifyApproval(deps.token, p.approval_id, payload, p.sig)) {
    throw new BridgeError(
      BRIDGE_ERRORS.APPROVAL_REQUIRED,
      `capture.send for ${p.channel} carries no valid approval signature`,
    );
  }
  const adapter = deps.adapterFor(p.channel);
  if (adapter === undefined) {
    throw new BridgeError(
      BRIDGE_ERRORS.RUNTIME_UNAVAILABLE,
      `no capture adapter for channel ${p.channel} on this host`,
    );
  }
  const result = await adapter.send(
    { accountId: p.channel, externalId: p.thread_external_id },
    { text: p.text, meta: { approval_id: p.approval_id, dry_run: p.dry_run } },
  );
  return {
    preview: p.text.slice(0, PREVIEW_MAX_CHARS),
    // `sent` means the message really left the machine: a dry run never does, and neither does an
    // adapter that reports its own dry-run id (kmsg's preview-and-sent:false, adapter §2.8).
    sent: !p.dry_run && !result.externalId.startsWith("dry-run:"),
  };
}

/**
 * Starts one capture loop per `[[capture]]` block: connect, subscribe, batch what comes out, notify.
 * A `subscribe()` that throws is not fatal — the loop reports it as a `disconnected` AdapterEvent
 * (so the hub's health path sees it) and retries after `restartMs`, forever.
 */
export function startCapture(blocks: CaptureConfig[], deps: CaptureDeps): CaptureHandle {
  const batchMs = deps.batchMs ?? DEFAULT_BATCH_MS;
  const restartMs = deps.restartMs ?? DEFAULT_RESTART_MS;
  const adapters = new Map<string, Adapter>();
  const pending = new Map<string, CapturedEvent[]>();
  const batchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const wakeups = new Set<() => void>();
  let stopped = false;

  const flush = (block: CaptureConfig): void => {
    const events = pending.get(block.channel);
    if (events === undefined || events.length === 0) return;
    pending.set(block.channel, []);
    const timer = batchTimers.get(block.channel);
    if (timer !== undefined) {
      clearTimeout(timer);
      batchTimers.delete(block.channel);
    }
    try {
      deps.notify("capture.items", {
        channel: block.channel,
        account_external_id: block.account_external_id,
        events,
      });
    } catch (e) {
      // notify() is the outbox's own path, so this only fires when the outbox write itself failed —
      // and a throw from a timer callback would take the whole agent down.
      deps.logger.error("capture notify failed", {
        channel: block.channel,
        count: events.length,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const push = (block: CaptureConfig, event: CapturedEvent): void => {
    const events = pending.get(block.channel) ?? [];
    events.push(event);
    pending.set(block.channel, events);
    if (events.length >= BATCH_MAX_EVENTS) {
      flush(block);
      return;
    }
    if (!batchTimers.has(block.channel)) {
      batchTimers.set(
        block.channel,
        setTimeout(() => {
          batchTimers.delete(block.channel);
          flush(block);
        }, batchMs),
      );
    }
  };

  /** Cancellable, so a stop() does not have to wait out a restart sleep. */
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const wake = (): void => {
        wakeups.delete(wake);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      wakeups.add(wake);
    });

  async function pump(block: CaptureConfig, adapter: Adapter): Promise<void> {
    const auth: AuthRef = {
      channel: block.channel,
      accountExternalId: block.account_external_id,
      // No secret exists for either capture channel — kmsg rides KakaoTalk.app's own login (A1 §2.8)
      // and LinkedIn keeps its cookies in the Playwright profile (A1 §2.9) — so these two fields are
      // a name for the audit trail, and neither adapter's connect() reads them.
      keychainService: `omnis.capture.${block.channel}`,
      keychainAccount: "omnis",
    };
    while (!stopped) {
      try {
        await adapter.connect(auth);
        for await (const event of adapter.subscribe()) {
          if (stopped) return;
          push(block, event);
        }
        return; // the stream ended on its own — a real end, not a failure, so do not reconnect
      } catch (cause) {
        // stop() has already flushed what was pending and cleared every batch timer, so a push from
        // here would arm a fresh timer and notify the hub after the agent said it had shut down.
        // The subscribe() path above is guarded the same way; this one is reached when a connect()
        // that stop() interrupted is followed by a failing subscribe().
        if (stopped) return;
        const reason = cause instanceof Error ? cause.message : String(cause);
        deps.logger.error("capture adapter failed; restarting", {
          channel: block.channel,
          restart_ms: restartMs,
          err: reason,
        });
        push(block, { kind: "disconnected", reason, at: new Date().toISOString() });
        await sleep(restartMs);
      }
    }
  }

  for (const block of blocks) {
    const adapter = adapters.get(block.channel) ?? deps.makeAdapter(block.channel);
    adapters.set(block.channel, adapter);
    // pump() catches every failure path itself, so this never fires today — but an unhandled
    // rejection crashes the whole agent, which is the opposite of what a per-channel restart loop
    // is for, and `void` alone discards the promise that would report it.
    void pump(block, adapter).catch((e: unknown) => {
      deps.logger.error("capture loop ended unexpectedly", {
        channel: block.channel,
        err: e instanceof Error ? e.message : String(e),
      });
    });
  }

  return {
    adapterFor: (channel) => adapters.get(channel),
    async stop(): Promise<void> {
      stopped = true;
      for (const timer of batchTimers.values()) clearTimeout(timer);
      batchTimers.clear();
      for (const wake of [...wakeups]) wake();
      // Whatever was captured but not yet flushed is still worth sending — the agent is shutting
      // down, and the outbox is the thing that keeps it.
      for (const block of blocks) flush(block);
      await Promise.allSettled([...adapters.values()].map((a) => a.disconnect?.()));
    },
  };
}
