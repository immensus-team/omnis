// US-C16 (C-D7): the hub's half of the terminal import. The bridge scanners (US-C14/US-C15) are
// pull RPCs; this file is the job that pulls them, and the refusal that keeps an imported transcript
// a transcript rather than a session someone can type into.
//
// The bridge is faked here on purpose: what this file guards is the hub's composition — the flag
// gate, the per-host cursor, the session key and the item idempotency key — not the scanners, which
// have their own suites in apps/local-agent.
import { createPool, one, query } from "@omnis/db";
import { type Kernel, createKernel, createLogger, setSetting } from "@omnis/kernel";
import { BRIDGE_ERRORS, type HostId, type HubMethod, type ImportedSession } from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BridgeHub, createBridgeHub } from "../../src/bridge.js";
import { runTerminalImport } from "../../src/terminal-import.js";

const TOKEN = "test-terminal-import-token";
const HOST = "macbook" as HostId;
const logger = createLogger("@omnis/hub", { sink: () => {} });

const CLAUDE_SOURCE = "aaaaaaaa-1111-4111-8111-111111111111";
const CODEX_SOURCE = "bbbbbbbb-2222-4222-8222-222222222222";

/** What `sessions.import_scan` answers with: two sessions, three turns. */
const SCAN: ImportedSession[] = [
  {
    runtime: "claude_code",
    source_id: CLAUDE_SOURCE,
    cwd: "/repo/omnis",
    started_at: "2026-09-21T10:00:00.000Z",
    turns: [
      {
        source_id: "turn-1",
        role: "user",
        at: "2026-09-21T10:00:00.000Z",
        text: "Import the transcripts",
        tool_calls: [],
      },
      {
        source_id: "turn-2",
        role: "agent",
        at: "2026-09-21T10:00:04.000Z",
        text: "Written the job",
        tool_calls: ["Bash"],
      },
    ],
  },
  {
    runtime: "codex",
    source_id: CODEX_SOURCE,
    cwd: "/repo/omnis2",
    started_at: "2026-09-21T09:00:00.000Z",
    turns: [
      {
        source_id: "turn-3",
        role: "user",
        at: "2026-09-21T09:00:00.000Z",
        text: "Check the rollout log",
        tool_calls: [],
      },
    ],
  },
];

interface Call {
  host: HostId;
  method: HubMethod;
  params: Record<string, unknown>;
}

/** A bridge that answers `sessions.import_scan` from a fixture and records every call. */
function fakeBridge(sessions: ImportedSession[] = SCAN): {
  bridge: Pick<BridgeHub, "call" | "hosts">;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    bridge: {
      hosts: () => [HOST],
      call: async <T>(host: HostId, method: HubMethod, params: Record<string, unknown>) => {
        calls.push({ host, method, params });
        if (method !== "sessions.import_scan") throw new Error(`unexpected method: ${method}`);
        return { sessions } as T;
      },
    },
  };
}

let pool: Pool;
let kernel: Kernel;
let bridge: BridgeHub;

async function clean(): Promise<void> {
  // Scoped to this story's own rows: the integration files share one database and a global count
  // assertion is order-dependent (the same trap session-items.test.ts documents).
  await query(pool, "DELETE FROM agent_sessions WHERE session_key LIKE 'agent:%:term-%'");
  await query(pool, "DELETE FROM threads WHERE external_id LIKE 'agent:%:term-%'");
}

async function counts(): Promise<{ sessions: number; items: number }> {
  const sessions = await one<{ n: string }>(
    pool,
    "SELECT count(*)::text AS n FROM agent_sessions WHERE session_key LIKE 'agent:%:term-%'",
  );
  const items = await one<{ n: string }>(
    pool,
    "SELECT count(*)::text AS n FROM items WHERE source_hash LIKE 'import:%'",
  );
  return { sessions: Number(sessions.n), items: Number(items.n) };
}

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool, logger });
  bridge = createBridgeHub({ kernel, pool, logger, token: TOKEN });
  // `ensureSession` refuses a runtime that never registered, so the two hosts' runtimes exist as if
  // the bridges had attached.
  await query(
    pool,
    `INSERT INTO agent_runtimes (runtime, host, display, capabilities, state, last_seen_at)
     VALUES ('claude_code', 'macbook', 'claude_code@macbook', '{}'::jsonb, 'online', now()),
            ('codex', 'macbook', 'codex@macbook', '{}'::jsonb, 'online', now())
     ON CONFLICT (runtime, host) DO UPDATE SET state = 'online', last_seen_at = now()`,
  );
});

afterAll(async () => {
  await clean();
  await bridge.close();
  await kernel.close();
  await pool.end();
});

describe("runTerminalImport (US-C16: the pull job behind import.terminal_sessions)", () => {
  it("does not call the bridge at all while the setting is off", async () => {
    await clean();
    await setSetting(pool, "import.terminal_sessions", false, "me");
    const { bridge: fake, calls } = fakeBridge();

    expect(await runTerminalImport({ pool, bridge: fake, logger })).toEqual({
      sessions: 0,
      items: 0,
    });
    expect(calls).toEqual([]);
  });

  it("imports each scanned session once and creates nothing on a second run", async () => {
    await clean();
    await setSetting(pool, "import.terminal_sessions", true, "me");
    const { bridge: fake, calls } = fakeBridge();

    expect(await runTerminalImport({ pool, bridge: fake, logger })).toEqual({
      sessions: 2,
      items: 3,
    });
    // The first run has no cursor for this host — it asks from the beginning.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toMatchObject({ since: null });

    const rows = await query<{ session_key: string; cwd: string | null }>(
      pool,
      "SELECT session_key, cwd FROM agent_sessions WHERE session_key LIKE 'agent:%:term-%' ORDER BY session_key",
    );
    expect(rows).toEqual([
      { session_key: "agent:claude_code:macbook:term-aaaaaaaa", cwd: "/repo/omnis" },
      { session_key: "agent:codex:macbook:term-bbbbbbbb", cwd: "/repo/omnis2" },
    ]);
    // The turn source_id is the idempotency key, namespaced by runtime — a re-import is a no-op
    // even though the bridge hands the same sessions back.
    const hashes = await query<{ source_hash: string }>(
      pool,
      "SELECT source_hash FROM items WHERE source_hash LIKE 'import:%' ORDER BY source_hash",
    );
    expect(hashes.map((h) => h.source_hash)).toEqual([
      "import:claude_code:turn-1",
      "import:claude_code:turn-2",
      "import:codex:turn-3",
    ]);

    const after1 = await counts();
    expect(after1).toEqual({ sessions: 2, items: 3 });

    expect(await runTerminalImport({ pool, bridge: fake, logger })).toEqual({
      sessions: 0,
      items: 0,
    });
    expect(await counts()).toEqual(after1);
  });

  it("asks from the newest imported item's sent_at on the next run", async () => {
    await clean();
    await setSetting(pool, "import.terminal_sessions", true, "me");
    const { bridge: fake, calls } = fakeBridge();
    await runTerminalImport({ pool, bridge: fake, logger });
    await runTerminalImport({ pool, bridge: fake, logger });

    // The cursor is the row's own sent_at — what the hub wrote, not what the transcript said, which
    // is why the two scanners' mtime freshness test and this cursor agree.
    const newest = await one<{ at: string }>(
      pool,
      `SELECT to_char(max(i.sent_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
         FROM items i WHERE i.source_hash LIKE 'import:%'`,
    );
    expect(calls[1]?.params.since).toBe(newest.at);
  });
});

describe("turn.start on an imported session (US-C16: a transcript is not a conversation)", () => {
  it("is refused with CAPABILITY_UNSUPPORTED, before any host is consulted", async () => {
    await expect(
      bridge.call(HOST, "turn.start", {
        session_key: "agent:claude_code:macbook:term-aaaaaaaa",
        input: { text: "carry on" },
      }),
    ).rejects.toMatchObject({ code: BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED });
  });

  it("still routes an ordinary session to the runtime, which is the only reason it fails here", async () => {
    // No bridge is attached in this file, so a session that is *not* import-only gets as far as the
    // connectivity check — the refusal above is about the session, not about turn.start.
    await expect(
      bridge.call(HOST, "turn.start", {
        session_key: "agent:claude_code:macbook:inbox-draft",
        input: { text: "carry on" },
      }),
    ).rejects.toMatchObject({ code: BRIDGE_ERRORS.RUNTIME_UNAVAILABLE });
  });
});
