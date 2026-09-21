// US-C16 (C-D7): the hub's half of the terminal import. The bridge opens its own vendor's
// transcripts, read-only and one file at a time (US-C14/US-C15); this is the job that pulls them —
// gated on `import.terminal_sessions`, one host at a time, idempotent by the turn's own source id.
//
// Nothing here executes a runtime: an imported session is a record of a terminal that already ran,
// which is why the same story refuses `turn.start` on it (bridge.ts).
import { query } from "@omnis/db";
import { type Logger, getSetting } from "@omnis/kernel";
import { type HostId, ImportScanResult, type ImportedSession } from "@omnis/protocol";
import type { Pool } from "pg";
import type { BridgeHub } from "./bridge.js";
import { ensureSession, writeAgentItem } from "./sessions.js";

/** 0015_phase_c.sql seeds the row. The two have to agree, or the row sits enabled and due forever
 *  with no handler behind it (the scheduler only ticks the names it was given). */
export const TERMINAL_IMPORT_JOB_NAME = "terminal_import";
export const TERMINAL_IMPORT_CRON = "*/5 * * * *";

/** ImportScanParams' own default, spelled out here so the job's appetite is visible next to the
 *  cursor that decides which sessions it reaches (see `cursorFor`). */
const MAX_SESSIONS = 50;

export interface TerminalImportDeps {
  pool: Pool;
  bridge: Pick<BridgeHub, "call" | "hosts">;
  logger: Logger;
  /** The run's clock, reported on the summary line. Injected so a test can pin it. */
  now?: () => Date;
}

/** `agent:<runtime>:<host>:<purpose>` (A2-D1). The source id comes off a file on a host, so the
 *  key has to survive whatever is in it: SessionKey's own grammar is
 *  `/^agent:[a-z_]+:(mini|macbook):[A-Za-z0-9_-]+$/` and anything outside it folds to a dash rather
 *  than travelling into a key another layer would reject. */
export function terminalSessionKey(runtime: string, host: string, sourceId: string): string {
  const short = sourceId.slice(0, 8).replace(/[^A-Za-z0-9_-]/g, "-");
  return `agent:${runtime}:${host}:term-${short}`;
}

/**
 * Where this host's next scan starts: the newest item the job itself wrote for it, or null the
 * first time. Items carry the import's own `sent_at` rather than the transcript's, which is the
 * clock the scanners' freshness filter reads (a transcript file's mtime).
 *
 * ponytail: this cursor stalls on a backlog — the scanners answer "the newest `max` transcripts
 * newer than `since`", so a host holding more than `max_sessions` transcripts never reaches the
 * oldest ones, however often the job runs. Draining that needs the scanners to page from a
 * low-water mark (an ascending scan, or a `before` param) — a bridge-side change, not a hub one.
 */
async function cursorFor(pool: Pool, host: string): Promise<string | null> {
  const rows = await query<{ at: Date | null }>(
    pool,
    `SELECT max(i.sent_at) AS at
       FROM items i JOIN threads t ON t.id = i.thread_id
      WHERE i.source_hash LIKE 'import:%' AND t.external_id LIKE 'agent:%:' || $1 || ':term-%'`,
    [host],
  );
  return rows[0]?.at?.toISOString() ?? null;
}

/** Which of these session keys the hub already has — the difference between an import that created
 *  a session and one that only found it again. */
async function knownSessions(pool: Pool, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await query<{ session_key: string }>(
    pool,
    "SELECT session_key FROM agent_sessions WHERE session_key = ANY($1)",
    [keys],
  );
  return new Set(rows.map((r) => r.session_key));
}

/** One host's page of sessions, or null when it has nothing to say — unreachable, or answering with
 *  a shape this protocol version cannot read. Either way the other hosts still get their import. */
async function scanHost(
  bridge: Pick<BridgeHub, "call">,
  host: HostId,
  since: string | null,
  logger: Logger,
): Promise<ImportedSession[] | null> {
  try {
    const result = ImportScanResult.parse(
      await bridge.call(host, "sessions.import_scan", { since, max_sessions: MAX_SESSIONS }),
    );
    return result.sessions;
  } catch (e) {
    logger.warn("terminal import scan failed", {
      host,
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export async function runTerminalImport(
  deps: TerminalImportDeps,
): Promise<{ sessions: number; items: number }> {
  const { pool, bridge, logger } = deps;
  // Off means off: no host enumerated, no bridge call, nothing read off anyone's disk. C-D7 makes
  // this import opt-in, so the gate is the first statement rather than a per-session check.
  if (!(await getSetting<boolean>(pool, "import.terminal_sessions", false))) {
    return { sessions: 0, items: 0 };
  }

  let sessions = 0;
  let items = 0;
  for (const host of bridge.hosts()) {
    const scan = await scanHost(bridge, host, await cursorFor(pool, host), logger);
    if (scan === null) continue;

    const keys = scan.map((s) => terminalSessionKey(s.runtime, host, s.source_id));
    const known = await knownSessions(pool, keys);
    for (const [index, parsed] of scan.entries()) {
      const sessionKey = keys[index] ?? "";
      const session = await ensureSession(pool, {
        runtime: parsed.runtime,
        host,
        sessionKey,
        cwd: parsed.cwd,
        // An imported session's runtime is not running: the terminal that wrote this transcript
        // exited, and the session is idle until someone reads it.
        state: "idle",
      });
      if (!known.has(sessionKey)) sessions += 1;
      for (const turn of parsed.turns) {
        // The vendor's own turn id, namespaced by runtime: the same turn re-imported (a later scan,
        // a restarted hub) merges into the row it already has instead of duplicating the session.
        const hash = `import:${parsed.runtime}:${turn.source_id}`;
        const created = await writeAgentItem(pool, {
          session,
          externalId: hash,
          sourceHash: hash,
          kind: "agent_turn",
          body: turn.text,
          tool: null,
        });
        if (created) items += 1;
      }
    }
  }

  // A five-minute job that logs its empty runs is 288 lines a day saying nothing happened.
  if (sessions > 0 || items > 0) {
    logger.info("terminal import", {
      sessions,
      items,
      at: (deps.now ?? ((): Date => new Date()))().toISOString(),
    });
  }
  return { sessions, items };
}
