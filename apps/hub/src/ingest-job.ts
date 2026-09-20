// A4 §6.1: local and Drive ride along on drive_poll (10 min); github_poll (15 min) runs separately.
import { t1Model } from "@omnis/agents";
import { type Logger, type Scheduler, getSetting } from "@omnis/kernel";
import {
  createCalendarProvider,
  createGithubProvider,
  createLocalMacbookProvider,
  createLocalMiniProvider,
  createT1Extractor,
  reembedNulls,
  registerIngestProvider,
  runIngest,
  setExtractor,
  watchLocalRoots,
} from "@omnis/memory";
import type { Pool } from "pg";
import type { BridgeHub } from "./bridge.js";

export async function registerIngestJobs(deps: {
  pool: Pool;
  logger: Logger;
  scheduler: Scheduler;
  bridge: BridgeHub;
}): Promise<() => void> {
  const { pool, logger, scheduler, bridge } = deps;

  // Without OMNIS_OPENROUTER_API_KEY, T1 extraction stays off and only T0 embedding runs — search
  // still works.
  try {
    setExtractor(createT1Extractor(t1Model()));
  } catch (e) {
    logger.warn("T1 extractor disabled", { err: e instanceof Error ? e.message : String(e) });
  }

  const miniRoots = await getSetting<string[]>(pool, "ingest.local_roots.mini", []);
  const macbookRoots = await getSetting<string[]>(pool, "ingest.local_roots.macbook", []);
  const repos = await getSetting<string[]>(pool, "ingest.github_repos", []);

  registerIngestProvider(createLocalMiniProvider({ roots: miniRoots }));
  registerIngestProvider(
    createLocalMacbookProvider({
      roots: macbookRoots,
      call: (method, params) => bridge.call("macbook", method, params),
    }),
  );
  registerIngestProvider(createCalendarProvider());
  registerIngestProvider(
    createGithubProvider({
      fetch: (url, init) => fetch(url, init),
      token: async () => process.env.OMNIS_GITHUB_TOKEN ?? "",
      repos,
    }),
  );
  // The Drive provider has no OAuth token supplier yet (US-B34, Keychain
  // omnis.gmail.<email> + refresh) — add one createDriveProvider line here when it lands
  // (open item #2 in the plan).

  scheduler.register("drive_poll", "*/10 * * * *", async () => {
    await runIngest({ pool, logger, kind: "file" });
    await runIngest({ pool, logger, kind: "calendar" });
    await runIngest({ pool, logger, kind: "drive" });
    // The only place that actually calls the "pick it up next cycle" A4 §10.5 promised. Rows that
    // landed with embedding=NULL while Ollama was down only come back to life here. This tick also
    // backfills when the embedding model or prefix changes and existing vectors must be dropped
    // (ops/mini/RUNBOOK.md, "re-embedding").
    const filled = await reembedNulls(pool);
    if (filled > 0) logger.info("reembedded memories", { filled });
  });
  scheduler.register("github_poll", "*/15 * * * *", async () => {
    await runIngest({ pool, logger, kind: "github" });
  });

  // A4 §10.6: weekly deny-pattern check. **--gate-only is mandatory** — scoring mode seeds 50
  // golden rows into whatever DB DATABASE_URL points at, and the hub's DATABASE_URL is the real DB
  // (omnis), so fake memories would be mixed into search permanently. Recall scoring belongs to a
  // CI/dev DB. A failure does not kill the hub — the log and the next briefing report it.
  scheduler.register("eval_weekly", "0 22 * * 0", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    try {
      const { stdout } = await run("pnpm", ["eval:memory", "--gate-only"], { cwd: process.cwd() });
      logger.info("memory deny-pattern gate", { report: stdout.trim().slice(0, 2000) });
    } catch (e) {
      logger.error("memory deny-pattern gate failed", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  });

  // A4 §10.1: the mini uses real-time FSEvents plus one rescan at boot. A notification does not
  // pull the next tick forward, it only logs — a 10-minute tick is enough, and there is no reason
  // to run embeddings on every save storm.
  // ponytail: when immediacy is needed, call a debounced runIngest from here.
  return watchLocalRoots({
    roots: miniRoots,
    logger,
    onChange: (path) => logger.debug("local file changed", { path }),
  });
}
