// US-C12, hub half. KakaoTalk and LinkedIn capture run on the mini's GUI session inside
// local-agent and reach the hub as `capture.items` notifications (A2 §3.3). The relay makes those
// items look like any other channel's: an `Adapter` the hub's own loops pump into the ingest sink,
// so the kernel, search and the inbox never learn that this channel had no client in the hub.
//
// The reverse direction goes through the same bridge: `send()` signs the draft with the bridge token
// and calls `capture.send` on the mini, which types it there (US-C13 gates that with the dry run).
import { query } from "@omnis/db";
import {
  ApprovalStateError,
  type EgressSpec,
  type Kernel,
  type Logger,
  type PendingApproval,
  kakaoSendState,
  kakaoSendStep,
  runEgress,
} from "@omnis/kernel";
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
import type { Pool } from "pg";
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

  /** The raw `capture.send` answer. `send()` (the Adapter contract) has no room for it, and US-C13's
   *  dry run *is* that preview — the first execution stores it on the approval card and only the
   *  second one asks for `dry_run: false`. */
  async captureSend(
    thread: ThreadRef,
    draft: Outbound,
  ): Promise<{ preview: string; sent: boolean }> {
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
    return await this.#deps.call<{ preview: string; sent: boolean }>(
      this.#deps.host,
      "capture.send",
      {
        ...payload,
        approval_id: approvalId,
        sig: signApproval(this.#deps.token, approvalId, payload),
      },
    );
  }

  async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
    const result = await this.captureSend(thread, draft);
    // The mini's real message id is not in the contract, so the id is synthesized from its answer:
    // `dry-run:` when nothing was typed, `capture:` when the message left the machine.
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

// ---- US-C13: the send gate's execution half ------------------------------------------------

export interface CaptureSendExecDeps {
  pool: Pool;
  kernel: Kernel;
  /** The relay table the bridge pushes items into. The send goes through the relay, so the approval
   *  signature is minted in exactly one place (`CaptureRelayAdapter.captureSend`). */
  relays: CaptureRelayLookup;
  logger: Logger;
}

export interface CaptureSendExecutor {
  /** Executes a decided `send` approval on a KakaoTalk thread. Safe to call twice: the claim inside
   *  runEgress is the mutex, and the loser throws ApprovalStateError. */
  execute(approvalId: string): Promise<void>;
  stop(): void;
}

/** The thread as the mini names it: `capture.send` talks in chat ids, the approval in thread uuids. */
interface KakaoThread {
  accountExternalId: string;
  threadExternalId: string;
}

/**
 * US-C13's two-approval flow, driven off the approval NOTIFY the same way delegate-exec is. The
 * first execution of an approved `send` types nothing: the preview the mini answers lands on that
 * approval as `args.dry_run_preview`, and a second `send` approval carrying `args.confirm_of` is
 * proposed. Only accepting that second one calls `capture.send` with `dry_run: false`.
 */
export function startCaptureSendExecutor(deps: CaptureSendExecDeps): CaptureSendExecutor {
  const { pool, logger } = deps;

  /** Direct row read, not `approvals.list()` — the same reason delegate-exec reads the row itself:
   *  list is capped, and a decided approval outside that window would sit unexecuted forever. */
  async function loadApproval(id: string): Promise<PendingApproval | null> {
    const rows = await query<PendingApproval>(
      pool,
      "SELECT * FROM pending_approvals WHERE id = $1",
      [id],
    );
    return rows[0] ?? null;
  }

  /** Null unless the approval hangs off a KakaoTalk thread: LinkedIn's write-back is its own
   *  approval-only path (US-A07), and every other channel sends through its own adapter. */
  async function loadKakaoThread(threadId: string | null): Promise<KakaoThread | null> {
    if (threadId === null) return null;
    const rows = await query<{
      channel: string;
      account_external_id: string;
      thread_external_id: string;
    }>(
      pool,
      `SELECT a.channel, a.external_id AS account_external_id, t.external_id AS thread_external_id
         FROM threads t JOIN accounts a ON a.id = t.account_id
        WHERE t.id = $1`,
      [threadId],
    );
    const row = rows[0];
    if (row === undefined || row.channel !== "kakaotalk") return null;
    return { accountExternalId: row.account_external_id, threadExternalId: row.thread_external_id };
  }

  /** The confirm half is real only when the dry run it names actually ran, on this thread, and
   *  previewed exactly this text. The executor proposes those approvals itself, but an agent proposes
   *  `send` args too — one that sets `confirm_of` itself would otherwise skip the dry run, which is
   *  the single thing US-C13 forbids. Null means "the dry run is there"; a string is the failure
   *  reason. The single-use half is not checked here: only the conditional UPDATE in the send below
   *  can decide that race. */
  async function confirmGap(
    a: PendingApproval,
    confirmOf: string,
    text: string,
  ): Promise<string | null> {
    const rows = await query<{
      state: string;
      thread_id: string | null;
      preview: unknown;
      confirmed: string | null;
      text: string | null;
    }>(
      pool,
      `SELECT state, thread_id, args->'dry_run_preview' AS preview, args->>'confirm_of' AS confirmed,
              args->>'text' AS text
         FROM pending_approvals WHERE action = 'send' AND id::text = $1`,
      [confirmOf],
    );
    const dry = rows[0];
    if (dry === undefined) return `kakao send confirm_of ${confirmOf} is not a send approval`;
    if (dry.state !== "executed") {
      return `kakao send confirm_of ${confirmOf} is ${dry.state}, not an executed dry run`;
    }
    if (dry.preview === null || dry.preview === undefined) {
      return `kakao send confirm_of ${confirmOf} has no dry run preview`;
    }
    // A confirm carries a `confirm_of` of its own, so it is an executed `send` with a preview too —
    // naming one would let a chain of approvals reach the window with no dry run in front of it.
    if (dry.confirmed !== null && dry.confirmed !== undefined) {
      return `kakao send confirm_of ${confirmOf} is a confirmation, not a dry run`;
    }
    // A dry run on another thread previewed another conversation, not this one.
    if (dry.thread_id !== a.thread_id) {
      return `kakao send confirm_of ${confirmOf} is on another thread`;
    }
    // ...and a dry run previews one message: what gets typed has to be what was shown.
    if (dry.text !== text) {
      return `kakao send confirm_of ${confirmOf} previewed different text`;
    }
    return null;
  }

  /** Claim then fail. A claim that loses the race means another caller owns the outcome — the
   *  guarded UPDATE in beginExecution is the only mutex between the NOTIFY subscriber and an
   *  explicit call. */
  async function claimAndFail(id: string, reason: string): Promise<void> {
    try {
      await deps.kernel.approvals.beginExecution(id);
    } catch (e) {
      // Only the lost race is expected. Anything else — a pool that just went away — must not be
      // swallowed at debug level: nothing re-drives a send, so the refusal would be lost and the row
      // would sit `decided` with no trace of why it never executed.
      if (!(e instanceof ApprovalStateError)) throw e;
      logger.debug("kakao send already claimed", { id, err: e.message });
      return;
    }
    await deps.kernel.approvals.failExecution(id, reason);
    logger.warn("kakao send refused", { id, reason });
  }

  const spec = (a: PendingApproval, action: string): EgressSpec => ({
    approvalId: a.id,
    actor: "me",
    action,
    targetTable: "threads",
    ...(a.thread_id === null ? {} : { targetId: a.thread_id }),
  });

  async function execute(approvalId: string): Promise<void> {
    const a = await loadApproval(approvalId);
    // A2 §5.1: only `send` executes, and only on a decision that means "do it".
    if (a === null || a.action !== "send") return;
    if (a.decision !== "accept" && a.decision !== "edit") return;
    const thread = await loadKakaoThread(a.thread_id);
    if (thread === null) {
      // No other executor claims `send`, so a decided one on another channel stays decided forever.
      // Nothing here can execute it (US-C13 owns KakaoTalk only), but the trace says so.
      logger.debug("send approval is not on a KakaoTalk thread — nothing to execute", { id: a.id });
      return;
    }

    const args = { ...a.args, ...(a.decided_args ?? {}) } as Record<string, unknown>;
    const step = kakaoSendStep(await kakaoSendState(pool), args);
    if (step.kind === "closed") {
      await claimAndFail(a.id, `kakao send closed (${step.reason})`);
      return;
    }
    // The args come from an agent's proposal, so the text is untrusted input to an irreversible
    // action — and once the message is typed there is nothing to roll back.
    const text = typeof args.text === "string" ? args.text : "";
    if (text.trim() === "") {
      await claimAndFail(a.id, "kakao send carries no text");
      return;
    }
    if (step.kind === "confirm") {
      const gap = await confirmGap(a, step.confirmOf, text);
      if (gap !== null) {
        await claimAndFail(a.id, gap);
        return;
      }
    }
    const relay = deps.relays.get("kakaotalk");
    if (relay === undefined) {
      await claimAndFail(a.id, "no kakaotalk capture relay");
      return;
    }
    // runEgress checks this too, but it does so before claiming: the row would stay `decided` and
    // nothing re-drives a send, so the switch is checked here where it can fail visibly (the same
    // choice delegate-exec made).
    if (await deps.kernel.killSwitch.isOn()) {
      await claimAndFail(a.id, "kill switch");
      return;
    }

    const ref: ThreadRef = {
      accountId: thread.accountExternalId,
      externalId: thread.threadExternalId,
    };

    if (step.kind === "confirm") {
      const confirmOf = step.confirmOf;
      await runEgress(deps.kernel, spec(a, "item.sent"), async () => {
        // The dry run backs one send, and the claim on it is taken before a single character is
        // typed: two confirms naming the same dry run cannot both reach the window. A send that
        // fails after this has spent its dry run — re-previewing is the cheap side of that trade.
        const claimed = await query<{ id: string }>(
          pool,
          `UPDATE pending_approvals SET args = args || jsonb_build_object('confirmed_by', $2::text)
            WHERE id = $1 AND args->>'confirmed_by' IS NULL
          RETURNING id`,
          [confirmOf, a.id],
        );
        if (claimed.length === 0) {
          throw new Error(`the dry run ${confirmOf} already backed a send`);
        }
        const r = await relay.captureSend(ref, {
          text,
          meta: { approval_id: a.id, dry_run: false },
        });
        // The mini answers for itself: its own `[capture] send_enabled` can still hold a send back
        // (the adapter forces a dry run), and a refusal is not a sent message. Its `preview` is the
        // message body verbatim, so it stays out of the reason — the reason is logged, shown on the
        // card and written to audit_log.
        if (!r.sent) throw new Error(`the mini did not send (approval ${a.id})`);
      });
      logger.info("kakao send executed", { approvalId: a.id, confirmOf });
      return;
    }

    const preview = await runEgress(deps.kernel, spec(a, "item.send_dry_run"), async () => {
      const r = await relay.captureSend(ref, { text, meta: { approval_id: a.id, dry_run: true } });
      // The dry run's whole point is that nothing was typed; if the mini says otherwise, the gate in
      // front of the real send was never there.
      if (r.sent) throw new Error("the mini typed the message on a dry run");
      // A5 §3.9: the preview is what the confirm card shows. The text is stored with it because the
      // human may have edited the approval, and the confirm has to send exactly what was previewed.
      await query(
        pool,
        `UPDATE pending_approvals
            SET args = args || jsonb_build_object('dry_run_preview', $2::text, 'text', $3::text)
          WHERE id = $1`,
        [a.id, r.preview, text],
      );
      return r.preview;
    });

    // Proposed only once that egress is done, so the confirm's target is `executed` before the confirm
    // exists: a confirm can never be decided against a dry run that is still executing. A propose that
    // throws leaves the executed dry run without a confirm and surfaces as `capture send executor
    // threw` — a dead end, but one that needs a broken DB and is loud rather than silent.
    const confirmId = await deps.kernel.approvals.propose({
      action: "send",
      args: { ...args, dry_run_preview: preview, confirm_of: a.id },
      description: `Confirm the KakaoTalk dry run: ${preview}`,
      // Accept, never edit: the preview in `args` is what the human approved, and a confirm carrying
      // different text is refused below, so offering the edit would only dead-end. Accept is forced on
      // rather than inherited — this confirm is the only route to a real send (US-C13), and an ask
      // that forbade accept (edit was its human's do-it decision) would otherwise propose a card
      // nobody can decide.
      config: { ...a.config, allow_accept: true, allow_edit: false },
      risk: a.risk,
      // The confirm belongs to the same ask, so it keeps the first approval's provenance.
      ...(a.requested_by === null ? {} : { requested_by: a.requested_by }),
      ...(a.thread_id === null ? {} : { thread_id: a.thread_id }),
      ...(a.item_id === null ? {} : { item_id: a.item_id }),
      ...(a.task_id === null ? {} : { task_id: a.task_id }),
    });
    logger.info("kakao send dry run complete — confirm proposed", {
      approvalId: a.id,
      confirmId,
    });
  }

  // A3 §6.2: the DB trigger sends the approval NOTIFY, so a decision taken anywhere (the desktop,
  // another hub process) reaches this executor without a caller.
  const unsubscribe = deps.kernel.events.subscribe("omnis_approval", (p) => {
    // A `pending` send waits for a human by definition — US-C13 has no allow rule that can pre-
    // approve one, so unlike delegate-exec there is nothing to do until it is decided.
    if (typeof p.id !== "string" || p.state !== "decided") return;
    void execute(p.id).catch((e: unknown) => {
      // A lost race is expected, not a fault: two callers can see the same NOTIFY (another hub process,
      // or an explicit call) and the winner owns the approval. runEgress claims outside its own try, so
      // it arrives here. It is a warn rather than silence because a row that moved underneath a
      // finished execution throws this same type, and that anomaly has to stay findable.
      if (e instanceof ApprovalStateError) {
        logger.warn("kakao send execution did not run", { approvalId: p.id, err: e.message });
        return;
      }
      logger.error("capture send executor threw", {
        approvalId: p.id,
        err: e instanceof Error ? e.message : String(e),
      });
    });
  });

  return { execute, stop: unsubscribe };
}
