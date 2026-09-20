import { query } from "@omnis/db";
import type { Logger } from "@omnis/kernel";
import type { Adapter, AdapterEvent, AuthRef, Channel, NormalizedItem } from "@omnis/protocol";
import type { Pool } from "pg";

// US-B45: `accounts` rows → `Adapter` instances. The hub deals only with the Keychain item **name**
// and never touches the value (A3-D4: `account_secrets.auth_ref` = the Keychain item name; each
// adapter's own `connect()` reads the value). The factory registry is injected, so a fake factory
// runs every path without real accounts or SDKs (B-D5).
//
// This module deliberately imports no channel SDK — the real factory table lives in `main.ts`.

/** A6 §9: the Keychain account is common to every item. Duplicated per package, like createLogger. */
const KEYCHAIN_ACCOUNT = "281932556+jinhologankim@users.noreply.github.com";

export interface AccountRow {
  id: string;
  channel: string;
  external_id: string;
  state: string;
  /** account_secrets.auth_ref — the Keychain item name, not the value. */
  auth_ref: string | null;
}

export type AdapterFactory = () => Adapter;
export type AdapterFactories = Partial<Record<string, AdapterFactory>>;

export interface AdapterStatus {
  accountId: string;
  channel: string;
  status: "healthy" | "degraded" | "down";
  error?: string;
}

type HealthReporter = (h: AdapterStatus) => Promise<void>;

/** One connected account: the adapter plus what the subscribe() loop needs (sink + health take an
 *  account id, the archive write-back takes a channel). */
export interface BoundAdapter {
  accountId: string;
  channel: Channel;
  adapter: Adapter;
}

export interface BuildAdaptersDeps {
  accounts: readonly AccountRow[];
  factories: AdapterFactories;
  logger: Logger;
  recordAdapterHealth?: HealthReporter;
  /** Ceiling for a single `connect()`. See connectWithTimeout. */
  connectTimeoutMs?: number;
}

// ponytail: one flat ceiling for every channel. gmail/outlook connect() reads the Keychain (a
// `security` subprocess that blocks while the keychain is locked) and then refreshes a token over
// the network; 15s is far beyond a healthy connect and far below a LaunchDaemon's tolerance.
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

/** A connect() can hang instead of rejecting, and buildAdapters runs before listen() — an
 *  unanswered one would keep /health from ever coming up (no listener, no signal handlers). Expiry
 *  behaves exactly like a rejection, so the caller keeps one failure path rather than two. */
async function connectWithTimeout(adapter: Adapter, auth: AuthRef, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      adapter.connect(auth),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`connect timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    // Without this the timer keeps the event loop alive for the full 15s after a fast connect.
    clearTimeout(timer);
  }
}

/** The registry's input: every account row plus its Keychain item name (A3-D4 — never the value).
 *  `account_secrets` is a LEFT JOIN so an account with no secret still shows up and gets logged. */
export async function loadAccountRows(pool: Pool): Promise<AccountRow[]> {
  return query<AccountRow>(
    pool,
    `SELECT a.id, a.channel, a.external_id, a.state, s.auth_ref
       FROM accounts a
       LEFT JOIN account_secrets s ON s.account_id = a.id`,
  );
}

/** Health reporting is best effort — ntfy may be down, the DB may blip. A failed report is logged
 *  and swallowed: it must never abort hub startup or kill a subscribe() loop. */
async function reportHealth(
  logger: Logger,
  report: HealthReporter | undefined,
  h: AdapterStatus,
): Promise<void> {
  if (report === undefined) return;
  try {
    await report(h);
  } catch (e) {
    logger.warn("adapter health report failed", {
      account: h.accountId,
      channel: h.channel,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function buildAdapters(deps: BuildAdaptersDeps): Promise<BoundAdapter[]> {
  const { accounts, factories, logger } = deps;
  const connectTimeoutMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const out: BoundAdapter[] = [];
  for (const a of accounts) {
    if (a.state !== "active") {
      logger.info("adapter skipped: account not active", {
        account: a.id,
        channel: a.channel,
        state: a.state,
      });
      continue;
    }
    const make = factories[a.channel];
    if (make === undefined) {
      // Phase C channels (kakaotalk/linkedin/whatsapp) and the 'agent'/'system' pseudo-accounts
      // land here, as does any channel whose app-level credentials are not configured yet.
      logger.warn("adapter skipped: no factory for channel", { account: a.id, channel: a.channel });
      continue;
    }
    if (a.auth_ref === null) {
      logger.warn("adapter skipped: account has no secret", { account: a.id, channel: a.channel });
      continue;
    }
    const auth: AuthRef = {
      channel: a.channel as Channel,
      accountExternalId: a.external_id,
      keychainService: a.auth_ref,
      keychainAccount: KEYCHAIN_ACCOUNT,
    };
    try {
      const adapter = make();
      await connectWithTimeout(adapter, auth, connectTimeoutMs);
      out.push({ accountId: a.id, channel: a.channel as Channel, adapter });
    } catch (e) {
      // If one account's expired token blocked hub startup, every other channel would die with it.
      const err = e instanceof Error ? e.message : String(e);
      logger.error("adapter connect failed", { account: a.id, channel: a.channel, err });
      await reportHealth(logger, deps.recordAdapterHealth, {
        accountId: a.id,
        channel: a.channel,
        status: "down",
        error: err,
      });
    }
  }
  return out;
}

/** The `adapters` map `createHubServer` takes is keyed by **channel**, which is how archive.ts
 *  (US-A36 write-back) looks it up — `adapters.get(row.channel)`. A channel with two accounts keeps
 *  the last one that connected; archive.ts's one-adapter-per-channel shape predates this task. */
export function adaptersByChannel(bound: readonly BoundAdapter[]): Map<string, Adapter> {
  return new Map(bound.map((b) => [b.channel, b.adapter]));
}

export interface AdapterLoops {
  /** Resolves once every subscribe() loop finishes — for tests. In production it usually never does. */
  drained(): Promise<void>;
  stop(): Promise<void>;
}

export interface StartLoopsDeps {
  adapters: readonly BoundAdapter[];
  sink: (accountId: string, e: NormalizedItem | AdapterEvent) => Promise<void>;
  logger: Logger;
  recordAdapterHealth?: HealthReporter;
  retryDelayMs?: number;
  maxRetries?: number;
}

export function startAdapterLoops(deps: StartLoopsDeps): AdapterLoops {
  const { adapters, sink, logger } = deps;
  const retryDelayMs = deps.retryDelayMs ?? 5_000;
  const maxRetries = deps.maxRetries ?? 3;
  let stopped = false;

  async function pump(bound: BoundAdapter): Promise<void> {
    const { accountId, adapter } = bound;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (stopped) return;
      try {
        for await (const e of adapter.subscribe()) {
          if (stopped) return;
          await sink(accountId, e);
        }
        return; // the stream ended normally — do not reconnect.
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        logger.error("adapter subscribe failed", {
          account: accountId,
          channel: adapter.channel,
          attempt,
          err,
        });
        await reportHealth(logger, deps.recordAdapterHealth, {
          accountId,
          channel: adapter.channel,
          status: "down",
          error: err,
        });
        if (attempt === maxRetries || stopped) return;
        // ponytail: fixed-delay reattach. If exponential backoff becomes necessary, promote it to a
        // job like token_refresh (the plan's YAGNI note) rather than growing this loop.
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }

  const running = adapters.map((b) => pump(b));
  return {
    drained: () => Promise.all(running).then(() => undefined),
    async stop() {
      stopped = true;
      await Promise.allSettled(adapters.map((b) => b.adapter.disconnect?.()));
      // The pumps are not awaited: one blocked inside subscribe() (a socket that never closes, a
      // retry sleep) would hold shutdown open until the 10s force exit. `stopped` makes each pump
      // return as soon as its current await settles. Tests use drained() for the real thing.
    },
  };
}
