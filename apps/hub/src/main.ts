import { createGmailAdapter } from "@omnis/adapter-gmail";
import { createGoogleCalendarAdapter } from "@omnis/adapter-google-calendar";
import { LINKEDIN_EMAIL_PREFIX } from "@omnis/adapter-linkedin";
import { createOutlookAdapter } from "@omnis/adapter-outlook";
import { createSlackAdapter } from "@omnis/adapter-slack";
import { createTelegramAdapter } from "@omnis/adapter-telegram";
import { configureAgents, startLoops, summarizeThread } from "@omnis/agents";
import { createPool, query } from "@omnis/db";
import {
  type Logger,
  assertZeroPublication,
  createKernel,
  createLogger,
  recordAdapterHealth,
} from "@omnis/kernel";
import type { Channel, HostId, NormalizedItem } from "@omnis/protocol";
import {
  type AdapterFactories,
  type AdapterStatus,
  adaptersByChannel,
  buildAdapters,
  loadAccountRows,
  startAdapterLoops,
} from "./adapters.js";
import { type BridgeDeps, type BridgeHub, createBridgeHub } from "./bridge.js";
import { type CaptureRelayRegistry, captureRelayRegistry } from "./capture-relay.js";
import { type HubConfig, readConfig } from "./config.js";
import { type DelegateExecutor, startDelegateExecutor } from "./delegate-exec.js";
import { createHubServer } from "./http.js";
import { registerIngestJobs } from "./ingest-job.js";
import { linkedinFromGmail } from "./linkedin-email-hook.js";
import { registerStartupJobs } from "./startup-jobs.js";
import { registerSummaryJob } from "./summarize-job.js";

export interface RunningHub {
  config: HubConfig;
  port: number;
  close(): Promise<void>;
}

/** US-C12/C-D3: the capture sidecars run on the mini's GUI session (kmsg needs Accessibility,
 *  LinkedIn needs a logged-in profile), so `capture.send` always goes to the mini. */
const CAPTURE_HOST: HostId = "mini";

/** US-B45: the real factory table — the one place that knows every channel package. A channel whose
 *  app-level credentials are missing is simply absent from the table, so its accounts log
 *  "adapter skipped: no factory for channel" at boot instead of failing there (no credentials exist
 *  yet). slack/telegram need none: those adapters read their own Keychain items in connect(). */
function adapterFactories(
  config: HubConfig,
  captureRelays: CaptureRelayRegistry,
  call: BridgeHub["call"],
): AdapterFactories {
  const factories: AdapterFactories = {
    slack: () => createSlackAdapter({}),
    telegram: () => createTelegramAdapter({}),
    // US-C12: kakaotalk/linkedin have no client in the hub at all — the relay is a façade over the
    // mini's sidecar, and its items arrive through bridge.ts's capture.items intake. The relay reads
    // no secret, but buildAdapters skips an account whose auth_ref is null (adapters.ts), so a
    // capture account still needs an account_secrets row holding a name nobody reads.
    ...captureRelays.factories({ call, token: config.bridgeToken, host: CAPTURE_HOST }),
  };
  if (config.googleOAuthClientId !== "" && config.googleOAuthClientSecret !== "") {
    const google = {
      oauthClientId: config.googleOAuthClientId,
      oauthClientSecret: config.googleOAuthClientSecret,
    };
    factories.gmail = () => createGmailAdapter(google);
    // Calendar shares the Gmail Cloud project's OAuth client (A1 §2.3).
    factories.gcal = () => createGoogleCalendarAdapter(google);
  }
  if (config.outlookClientId !== "") {
    // The adapter itself pins the /common tenant (packages/adapters/outlook/src/index.ts), so there
    // is no OMNIS_OUTLOOK_TENANT to read here.
    factories.outlook = () => createOutlookAdapter({ oauthClientId: config.outlookClientId });
  }
  return factories;
}

export async function startHub(env: NodeJS.ProcessEnv = process.env): Promise<RunningHub> {
  const config = readConfig(env);
  const logger = createLogger("@omnis/hub");
  const pool = createPool(env);
  // US-C09 (A1 §2.9): a LinkedIn notification email is a "new message arrived" ping whose body is
  // only the preview, so its item is written `meta.partial`. The marker travels as item meta, not as
  // a channel or a column, because the derived item is an ordinary `linkedin` item in every other
  // respect — US-C10's Playwright adapter fills the real message in later.
  const itemMeta = (e: NormalizedItem): Record<string, unknown> | undefined =>
    e.externalId.startsWith(LINKEDIN_EMAIL_PREFIX) ? { partial: true } : undefined;
  const kernel = createKernel({ pool, logger, itemMeta });
  // Booting with the Zero schema and the publication out of sync shows the desktop an empty inbox.
  // Break at boot instead.
  await assertZeroPublication(pool);

  registerStartupJobs(kernel.scheduler, {
    pool,
    events: kernel.events,
    audit: kernel.audit,
    logger,
  });
  await kernel.scheduler.start();

  // B3: the one-line AI summary on kinso inbox rows — @omnis/agents uses a module singleton pool (pool.ts).
  configureAgents({ pool });
  const stopSummaryJob = registerSummaryJob({
    events: kernel.events,
    logger,
    summarizeThread,
  });
  // Attach the registered loops to kernel events / the scheduler (A4 §1.2).
  const stopLoops = startLoops({ kernel, logger });

  // US-C03: the bridge and the delegation executor need each other — the bridge hands finished
  // turns to the executor, the executor calls back through the bridge — so the hooks are attached
  // to the deps object once the executor exists. bridge.ts reads them per notification, not at
  // creation, so neither construction order can drop a delegation.
  // One relay table per process: the factories below register into it, and the bridge routes every
  // capture.items batch through the same instance the subscribe() loop is pumping.
  const captureRelays = captureRelayRegistry();
  const bridgeDeps: BridgeDeps = {
    kernel,
    pool,
    logger,
    token: config.bridgeToken,
    captureRelays,
  };
  const bridge = createBridgeHub(bridgeDeps);
  if (config.bridgeToken === "") {
    logger.warn("OMNIS_BRIDGE_TOKEN is empty — WS /bridge refuses every upgrade with 503");
  }
  const delegateExec = startDelegateExecutor({
    pool,
    kernel,
    bridge,
    token: config.bridgeToken,
    killSwitch: kernel.killSwitch,
    logger,
  });
  const hookFailed =
    (name: string) =>
    (e: unknown): void => {
      logger.error(`delegate ${name} failed`, { err: e instanceof Error ? e.message : String(e) });
    };
  bridgeDeps.onTurnCompleted = (host, p) => {
    void delegateExec.onTurnCompleted(host, p).catch(hookFailed("onTurnCompleted"));
  };
  bridgeDeps.onHostConnected = (host) => {
    void delegateExec.redrive(host).catch(hookFailed("onHostConnected"));
  };
  // The ingest jobs are registered **after** start() (the same slot as startLoops). The
  // drive_poll/github_poll rows were already seeded by 0006_kernel.sql and tick() re-scans the
  // handlers Map every tick, so they run on the next tick (10s). Registering before start() would
  // make the await tick() at the end of start() pick up the seeded due rows immediately and run a
  // whole ingestion round (local scan, embedding, T1) synchronously before listen() — with neither
  // /health nor the signal handlers alive in the meantime.
  const stopIngestWatch = await registerIngestJobs({
    pool,
    logger,
    scheduler: kernel.scheduler,
    bridge,
  });

  // US-B45: accounts + account_secrets.auth_ref → live adapters. The hub passes the Keychain item
  // *name* only; each adapter fetches the value (A3-D4). With zero connected accounts this is a
  // no-op and the hub still boots.
  const factories = adapterFactories(config, captureRelays, bridge.call);
  logger.info("adapter registry", { configured: Object.keys(factories) });
  const accountRows = await loadAccountRows(pool);
  // The status→ok mapping already covers the recovery path: "healthy" is `!== "down"`, so it reaches
  // recordAdapterHealth(ok=true) and clears the failure counter / restores a 'broken' account.
  const reportAdapterHealth = (h: AdapterStatus): Promise<void> =>
    recordAdapterHealth(
      { pool, logger, ntfy: { url: config.ntfyUrl } },
      h.channel as Channel,
      h.status !== "down",
      h.error,
    );
  const boundAdapters = await buildAdapters({
    accounts: accountRows,
    factories,
    logger,
    recordAdapterHealth: reportAdapterHealth,
  });
  // createHubServer takes the channel-keyed map — archive.ts (US-A36 write-back) looks it up with
  // adapters.get(row.channel); the subscribe() loops iterate the account-bound list.
  const adapters = adaptersByChannel(boundAdapters);
  const adapterLoops = startAdapterLoops({
    adapters: boundAdapters,
    // US-C09: wrapped, so a LinkedIn message notification seen by the Gmail pipeline emits one more
    // item on the `linkedin` account. With no linkedin account row (US-C10 has not run) the hook
    // forwards everything unchanged.
    sink: linkedinFromGmail({
      findLinkedInAccount: async () => {
        const rows = await query<{ id: string }>(
          pool,
          "SELECT id FROM accounts WHERE channel = 'linkedin' ORDER BY created_at, id LIMIT 1",
        );
        return rows[0]?.id ?? null;
      },
      sink: kernel.ingest.sink,
    }),
    logger,
    recordAdapterHealth: reportAdapterHealth,
  });
  logger.info("adapter registry ready", {
    accounts: accountRows.length,
    connected: boundAdapters.length,
    channels: [...adapters.keys()],
  });

  const startedAt = Date.now();
  const server = createHubServer({
    kernel,
    pool,
    config,
    logger,
    startedAt,
    adapters,
    onUpgrade: (req, socket, head) => bridge.handleUpgrade(req, socket, head),
  });
  // The hub.started audit entry is written before listen(): with an await left after listen, /health
  // already answers while installSignalHandlers is not attached yet, and a SIGTERM arriving in that
  // window would take the default disposition (forced exit, exit code null).
  await kernel.audit.record({ actor: "system", action: "hub.started", target_table: "jobs" });
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  logger.info("hub listening", { host: config.host, port: config.port, version: config.version });

  let closing: Promise<void> | null = null;
  return {
    config,
    port: config.port,
    close() {
      if (closing !== null) return closing;
      closing = (async () => {
        // 1) Stop accepting connections; drop keep-alives immediately.
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections();
          setTimeout(() => server.closeAllConnections(), 2000).unref();
        });
        await bridge.close();
        // 2) Detach the channel adapters before the scheduler and the pool go away, so no
        // subscribe() loop can push into a closed pool.
        await adapterLoops.stop();
        stopIngestWatch();
        stopSummaryJob();
        stopLoops();
        // Drop the approval NOTIFY subscription before the pool goes away.
        delegateExec.stop();
        // 3) Stop the scheduler and wait for an in-flight tick to release claimed_at (Task 14's stop()).
        // 4) Drop the LISTEN connection.
        await kernel.close();
        await kernel.audit.record({ actor: "system", action: "hub.stopped", target_table: "jobs" });
        await pool.end();
        logger.info("hub stopped");
      })();
      return closing;
    },
  };
}

/** SIGTERM/SIGINT → close(). If it does not finish within 10s, force exit (the LaunchDaemon restarts it). */
export function installSignalHandlers(
  hub: RunningHub,
  logger: Logger,
  forceExitMs = 10_000,
): () => void {
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutdown requested", { signal });
    const force = setTimeout(() => {
      logger.error("shutdown timed out — forcing exit", { forceExitMs });
      process.exit(1);
    }, forceExitMs);
    force.unref();
    hub
      .close()
      .then(() => {
        clearTimeout(force);
        process.exit(0);
      })
      .catch((e: unknown) => {
        logger.error("shutdown failed", { err: e instanceof Error ? e.message : String(e) });
        process.exit(1);
      });
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  return () => {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  };
}

// Boot only when run directly (tests import startHub).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const hub = await startHub();
  installSignalHandlers(hub, createLogger("@omnis/hub"));
}
