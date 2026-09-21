// US-C12, hub half. KakaoTalk and LinkedIn capture run on the mini's GUI session inside
// local-agent and reach the hub as `capture.items` notifications (A2 §3.3). The relay makes those
// items look like any other channel's: an `Adapter` the hub's own loops pump into the ingest sink,
// so the kernel, search and the inbox never learn that this channel had no client in the hub.
//
// The reverse direction goes through the same bridge: `send()` signs the draft with the bridge token
// and calls `capture.send` on the mini, which types it there (US-C13 gates that with the dry run).
import type { Logger } from "@omnis/kernel";
import {
  type Adapter,
  type AdapterEvent,
  AdapterEvent as AdapterEventSchema,
  type AuthRef,
  BRIDGE_ERRORS,
  BridgeError,
  type Capabilities,
  CaptureItemsParams,
  type Health,
  type HostId,
  type NormalizedItem,
  type Outbound,
  type SendResult,
  type ThreadRef,
  signApproval,
} from "@omnis/protocol";
import type { AdapterFactories } from "./adapters.js";
import type { BridgeHub } from "./bridge.js";

export type CaptureChannel = "kakaotalk" | "linkedin";

export interface CaptureRelayDeps {
  /** The hub → bridge RPC (`capture.send`). Injected so tests drive the relay with no socket. */
  call: BridgeHub["call"];
  /** The bridge token: the same secret signs here and verifies on the mini (A2 §5.1). */
  token: string;
  /** The host running the capture sidecar — the mini, per C-D3 (kmsg needs Accessibility). */
  host: HostId;
}

/** A1 §2.8/§2.9, mirrored: the relay advertises what the channel can actually do. `write` is closed
 *  for both — KakaoTalk opens only when US-C13's 14-day gate does, and LinkedIn's write-back is
 *  approval-only (US-A07), never a capability of the capture path itself. */
const CHANNEL_CAPS: Record<CaptureChannel, Capabilities> = {
  kakaotalk: {
    read: true,
    write: false,
    realtime: true, // kmsg watch
    history: false, // only the conversation that is open
    media: false,
    markRead: false,
    typing: false,
    archive: false,
    delete: false,
  },
  linkedin: {
    read: true,
    write: false,
    realtime: false, // 5-15 minute polling, deliberately (A1 §2.9)
    history: true, // the one-time first-login inbox pass
    media: true,
    markRead: false,
    typing: false,
    archive: false,
    delete: false,
  },
};

export function captureCapabilities(
  channel: CaptureChannel,
  opts: { write?: boolean } = {},
): Capabilities {
  return { ...CHANNEL_CAPS[channel], write: opts.write === true };
}

/** The adapter packages' own queue, unchanged: one buffered push queue with waiters (kakaotalk,
 *  linkedin, slack, telegram and whatsapp each carry the same 20 lines; this is the sixth copy and
 *  the reason it is still not in @omnis/protocol is that it is not a wire type). */
class AsyncQueue<T> {
  private buffered: T[] = [];
  private waiters: Array<(v: IteratorResult<T>) => void> = [];
  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }
    this.buffered.push(value);
  }
  private async next(): Promise<IteratorResult<T>> {
    const value = this.buffered.shift();
    if (value !== undefined) return { value, done: false };
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }
}

export class CaptureRelayAdapter implements Adapter {
  readonly id: string;
  readonly channel: CaptureChannel;
  readonly #deps: CaptureRelayDeps;
  readonly #queue = new AsyncQueue<NormalizedItem | AdapterEvent>();
  #accountExternalId: string | null = null;
  #status: Health["status"] = "down";
  #lastEventAt: string | null = null;

  constructor(channel: CaptureChannel, deps: CaptureRelayDeps) {
    this.channel = channel;
    this.id = `capture-relay:${channel}`;
    this.#deps = deps;
  }

  /** Which account this relay speaks for, learned at connect(). The intake compares it against the
   *  batch's `account_external_id` so one channel's capture cannot land on another's account. */
  get accountExternalId(): string | null {
    return this.#accountExternalId;
  }

  /** bridge.ts's `capture.items` lands here; `subscribe()` yields exactly what was pushed. */
  push(events: (NormalizedItem | AdapterEvent)[]): void {
    for (const event of events) {
      this.#lastEventAt = new Date().toISOString();
      const adapterEvent = AdapterEventSchema.safeParse(event);
      if (adapterEvent.success) {
        if (adapterEvent.data.kind === "connected") this.#status = "healthy";
        // The sidecar's restart loop reports each failed attempt this way — degraded, not down: it
        // is retrying, and the hub's other channels must not be affected by the mini's UI state.
        if (adapterEvent.data.kind === "disconnected") this.#status = "degraded";
      }
      this.#queue.push(event);
    }
  }

  capabilities(): Capabilities {
    return captureCapabilities(this.channel);
  }

  async connect(auth: AuthRef): Promise<void> {
    // Nothing to read: kmsg rides KakaoTalk.app's own login and LinkedIn keeps its cookies in the
    // Playwright profile (A1 §2.8/§2.9). The account id is all this relay needs from the row, and
    // the hub passes only the Keychain item *name* anyway (A3-D4).
    this.#accountExternalId = auth.accountExternalId;
    this.#status = "healthy";
    this.#lastEventAt = new Date().toISOString();
  }

  async disconnect(): Promise<void> {
    this.#status = "down";
  }

  backfill(): AsyncIterable<NormalizedItem> {
    // No history path: the channel's own window on the mini is what subscribe() streams, and kmsg's
    // history is false (A1 §2.8). The relay has nothing to ask the mini for.
    return {
      [Symbol.asyncIterator](): AsyncIterator<NormalizedItem> {
        return { next: () => Promise.resolve({ value: undefined, done: true }) };
      },
    };
  }

  subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
    return this.#queue;
  }

  async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
    const approvalId = draft.meta?.approval_id;
    if (typeof approvalId !== "string" || approvalId === "") {
      throw new BridgeError(
        BRIDGE_ERRORS.APPROVAL_REQUIRED,
        `capture ${this.channel} send needs an approval_id in Outbound.meta (US-C13)`,
      );
    }
    const dryRun = draft.meta?.dry_run === true;
    const payload = {
      channel: this.channel,
      thread_external_id: thread.externalId,
      text: draft.text,
      dry_run: dryRun,
    };
    const result = await this.#deps.call<{ preview: string; sent: boolean }>(
      this.#deps.host,
      "capture.send",
      {
        ...payload,
        approval_id: approvalId,
        sig: signApproval(this.#deps.token, approvalId, payload),
      },
    );
    // `capture.send` answers {preview, sent} (contract §3) — the mini's real message id is not in the
    // contract, and there is none to report anyway while `write` is closed: in W1 every send is dry.
    return {
      externalId: `${result.sent ? "capture" : "dry-run"}:${thread.externalId}`,
      sentAt: new Date().toISOString(),
    };
  }

  async health(): Promise<Health> {
    return {
      channel: this.channel,
      accountExternalId: this.#accountExternalId ?? "",
      status: this.#status,
      lastEventAt: this.#lastEventAt,
    };
  }
}

/** What the intake needs of the registry — narrow enough that a test can hand it one relay. */
export interface CaptureRelayLookup {
  get(channel: string): CaptureRelayAdapter | undefined;
}

export interface CaptureRelayRegistry extends CaptureRelayLookup {
  factories(deps: CaptureRelayDeps): AdapterFactories;
}

/**
 * One registry per hub process. `factories()` is what the account registry calls (buildAdapters →
 * factories[channel]()), and it is also what registers the relay that `capture.items` is routed to,
 * so the adapter the loops pump and the adapter the bridge pushes into are the same object.
 */
export function captureRelayRegistry(): CaptureRelayRegistry {
  const relays = new Map<string, CaptureRelayAdapter>();
  const make = (channel: CaptureChannel, deps: CaptureRelayDeps): CaptureRelayAdapter => {
    const relay = new CaptureRelayAdapter(channel, deps);
    relays.set(channel, relay);
    return relay;
  };
  return {
    get: (channel) => relays.get(channel),
    factories: (deps) => ({
      kakaotalk: () => make("kakaotalk", deps),
      linkedin: () => make("linkedin", deps),
    }),
  };
}

export type CaptureIntakeVerdict = { accepted: number } | { rejected: string };

export interface CaptureIntakeDeps {
  /** Absent when the hub runs no capture channels: every batch is then dropped and logged. */
  relays: CaptureRelayLookup | undefined;
  logger: Logger;
}

/**
 * bridge.ts's `capture.items` intake. The batch is validated whole — one malformed item drops all of
 * it, because a partially ingested batch is a partial thread — and a drop is logged rather than
 * answered: `capture.items` is a notification, and the mini has already moved on (its outbox only
 * holds what the socket refused).
 */
export async function intakeCaptureItems(
  params: unknown,
  deps: CaptureIntakeDeps,
): Promise<CaptureIntakeVerdict> {
  const parsed = CaptureItemsParams.safeParse(params);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((i) => `${i.path.join(".") || "batch"}: ${i.message}`)
      .join("; ");
    deps.logger.warn("capture.items rejected", { reason });
    return { rejected: reason };
  }
  const { channel, account_external_id, events } = parsed.data;
  const relay = deps.relays?.get(channel);
  if (relay === undefined) {
    const reason = `no capture relay for channel ${channel}`;
    deps.logger.warn("capture.items dropped", { channel, reason });
    return { rejected: reason };
  }
  // The relay is bound to one account (connect() → the accounts row buildAdapters picked for this
  // channel), so a batch naming any other account is stale: the mini's TOML was edited and the hub
  // side was not, and ingesting it would file someone else's messages under this account.
  if (relay.accountExternalId !== null && relay.accountExternalId !== account_external_id) {
    const reason = `batch for account ${account_external_id}, relay serves ${relay.accountExternalId}`;
    deps.logger.warn("capture.items dropped", { channel, reason });
    return { rejected: reason };
  }
  relay.push(events);
  return { accepted: events.length };
}
