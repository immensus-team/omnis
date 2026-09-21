// US-C15 (C-D7): the bridge's read-only Codex rollout import — the sibling of import-claude.test.ts.
//
// The record shapes below are the ones the plan states and are UNVERIFIED until US-C29's live check:
// `session_meta` carries the session's id/cwd/time, `response_item` carries messages and function
// calls, and every other record type is skipped rather than fatal. Two contracts the fixture alone
// cannot express are pinned here:
//  ① the scanner opens only `codexHome/sessions/**/rollout-*.jsonl` — the readFile spy records every
//    path it is handed, so a future change that widens the walk fails loudly;
//  ② containment is decided on the rollout's *unmasked* cwd, so masking can never change which
//    sessions a host admits.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { ImportScanResult, withMeta } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import type { ImportDeps } from "../src/import/claude-jsonl.js";
import { parseCodexRollout, scanCodexSessions } from "../src/import/codex-rollout.js";
import { createLogger } from "../src/logger.js";
import { createDispatcher } from "../src/rpc-dispatch.js";
import { SessionRegistry } from "../src/session-registry.js";

const here = new URL(".", import.meta.url).pathname;
const CLAUDE_HOME = join(here, "fixtures", "claude-home");
const CODEX_HOME = join(here, "fixtures", "codex-home");
const SESSIONS = join(CODEX_HOME, "sessions");
const ROLLOUT = join(SESSIONS, "2026", "09", "21", "rollout-2026-09-21T10-00-00-0b6c1d2e.jsonl");
/** A non-rollout `.jsonl` beside the rollout: C-D7 admits `rollout-*.jsonl` only. */
const HISTORY = join(SESSIONS, "2026", "09", "21", "history.jsonl");
const AUTH = join(CODEX_HOME, "auth.json");
/** The Claude Code fixture's session id — the dispatcher test merges both scanners, so they differ. */
const CLAUDE_SESSION = "0b6c1d2e-0000-4000-8000-000000000001";
const CODEX_SESSION = "0b6c1d2e-0000-4000-8000-0000000000c1";
/** The value the live bridge knows from the keychain — masking it must not depend on its shape. */
const KNOWN_SECRET = "OMNIS_TEST_TOKEN_KNOWN_VALUE";

const deps = (over: Partial<ImportDeps> = {}): ImportDeps => ({
  claudeHome: CLAUDE_HOME,
  codexHome: CODEX_HOME,
  allowedRoots: ["/repo"],
  secrets: [KNOWN_SECRET],
  ...over,
});

/** A `~/.codex` stand-in with the given rollout files, keyed by path relative to the home. */
async function tempCodexHome(files: Record<string, string>): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "omnis-codex-import-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(home, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return home;
}

const metaLine = (payload: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) =>
  JSON.stringify({
    timestamp: "2026-09-21T10:00:00.000Z",
    type: "session_meta",
    payload: {
      id: CODEX_SESSION,
      timestamp: "2026-09-21T10:00:00.000Z",
      cwd: "/repo/omnis",
      ...payload,
    },
    ...envelope,
  });

const msgLine = (
  role: "user" | "assistant",
  text: string,
  payload: Record<string, unknown> = {},
  envelope: Record<string, unknown> = {},
) =>
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: role === "user" ? "input_text" : "output_text", text }],
      ...payload,
    },
    ...envelope,
  });

const callLine = (name: string) =>
  JSON.stringify({
    type: "response_item",
    payload: { type: "function_call", name, arguments: "{}", call_id: "call_x" },
  });

describe("parseCodexRollout", () => {
  it("keeps the session meta and the message turns, and skips every other record type", async () => {
    const parsed = parseCodexRollout(await readFile(ROLLOUT, "utf8"));

    expect(parsed.cwd).toBe("/repo/omnis");
    expect(parsed.sessionId).toBe(CODEX_SESSION);
    // The first turn's own timestamp, a second after `session_meta`'s — so this is the turn's `at` and
    // not the meta time. (A turn that carried none would fall back to the meta time; the test below
    // pins that, and a rollout with no readable turn at all is dropped rather than started at meta.)
    expect(parsed.startedAt).toBe("2026-09-21T10:00:01.000Z");
    expect(parsed.turns.map((t) => t.role)).toEqual(["user", "agent", "agent"]);
    expect(parsed.turns.map((t) => t.at)).toEqual([
      "2026-09-21T10:00:01.000Z",
      "2026-09-21T10:00:05.000Z",
      "2026-09-21T10:00:09.000Z",
    ]);
    // No per-item id is assumed in the record shape, so the key is synthesised from the session id
    // and the turn's position — stable across re-imports, which is what the hub's dedupe needs.
    expect(parsed.turns.map((t) => t.source_id)).toEqual([
      `${CODEX_SESSION}:0`,
      `${CODEX_SESSION}:1`,
      `${CODEX_SESSION}:2`,
    ]);
    expect(parsed.turns[0]?.text).toBe("Import the Codex rollout.");
    expect(parsed.turns[0]?.tool_calls).toEqual([]);
    expect(parsed.turns[1]?.text).toBe("Reading the rollout format first.");
    // Both calls follow the assistant turn that asked for them.
    expect(parsed.turns[1]?.tool_calls).toEqual(["shell", "read_file"]);
    expect(parsed.turns[2]?.tool_calls).toEqual([]);

    // The whole file is read even though five of its lines are unusable, and nothing but the stated
    // fields of a known record reaches the result.
    const blob = JSON.stringify(parsed);
    expect(blob).not.toContain("provenance");
    expect(blob).not.toContain("token_count");
    expect(blob).not.toContain("summary_text");
    expect(blob).not.toContain("call_1");
    expect(blob).not.toContain("arguments");
  });

  it("reports nulls for a file with nothing usable in it", () => {
    expect(parseCodexRollout('not JSON\n\n{"type":"event_msg","payload":{}}')).toEqual({
      cwd: null,
      sessionId: null,
      startedAt: null,
      turns: [],
    });
  });

  it("prefers the record's own timestamp and falls back to session_meta's", () => {
    const parsed = parseCodexRollout(
      [
        metaLine(),
        msgLine("user", "stamped", {}, { timestamp: "2026-09-21T10:00:02.000Z" }),
        msgLine("assistant", "unstamped"),
      ].join("\n"),
    );

    expect(parsed.startedAt).toBe("2026-09-21T10:00:02.000Z");
    expect(parsed.turns.map((t) => t.at)).toEqual([
      "2026-09-21T10:00:02.000Z",
      "2026-09-21T10:00:00.000Z",
    ]);
  });

  it("keeps a record's own id and synthesises the rest", () => {
    const parsed = parseCodexRollout(
      [
        metaLine(),
        msgLine("assistant", "named", { id: "item-1" }),
        msgLine("assistant", "anonymous"),
      ].join("\n"),
    );

    expect(parsed.turns.map((t) => t.source_id)).toEqual(["item-1", `${CODEX_SESSION}:1`]);
  });

  it("attaches a function call to the agent turn it follows, or to the next one", () => {
    const parsed = parseCodexRollout(
      [
        metaLine(),
        callLine("first_call"), // leads: no agent turn to attach it to yet
        msgLine("user", "do the thing"),
        callLine("second_call"), // still no agent turn — a user turn is not one
        msgLine("assistant", "working"),
        callLine("third_call"), // follows the agent turn above
        JSON.stringify({ type: "response_item", payload: { type: "function_call" } }), // no name
      ].join("\n"),
    );

    expect(parsed.turns.map((t) => t.role)).toEqual(["user", "agent"]);
    expect(parsed.turns[0]?.tool_calls).toEqual([]);
    expect(parsed.turns[1]?.tool_calls).toEqual(["first_call", "second_call", "third_call"]);
  });
});

describe("scanCodexSessions", () => {
  it("imports the in-root rollout, masked, in the shape the hub parses", async () => {
    const sessions = await scanCodexSessions(null, 10, deps());

    expect(sessions).toHaveLength(1);
    const [session] = sessions;
    expect(session?.runtime).toBe("codex");
    expect(session?.source_id).toBe(CODEX_SESSION);
    expect(session?.cwd).toBe("/repo/omnis");
    expect(session?.started_at).toBe("2026-09-21T10:00:01.000Z");
    expect(session?.turns.map((t) => t.role)).toEqual(["user", "agent", "agent"]);
    expect(session?.turns[1]?.tool_calls).toEqual(["shell", "read_file"]);

    const masked = session?.turns[2]?.text ?? "";
    expect(masked).toContain("***");
    expect(masked).not.toContain("sk-");
    expect(masked).not.toContain("ghp_");
    expect(masked).not.toContain(KNOWN_SECRET);
    // The fixture also hides secrets in a function call's `arguments` and in a call output — the
    // channels a shell command would actually carry a token through. Neither field is read at all
    // today, so these assertions are what would catch a future change that starts echoing them.
    const blob = JSON.stringify(sessions);
    expect(blob).not.toContain("provenance");
    expect(blob).not.toContain(KNOWN_SECRET);
    expect(blob).not.toContain("sk-");
    expect(blob).not.toContain("ghp_");
    // And what the scanner produced is what the hub will parse (packages/protocol/src/bridge.ts).
    expect(ImportScanResult.parse({ sessions }).sessions).toHaveLength(1);
  });

  it("does not treat a sibling of an allowed root as inside it", async () => {
    expect(await scanCodexSessions(null, 10, deps({ allowedRoots: ["/rep"] }))).toEqual([]);
    expect(await scanCodexSessions(null, 10, deps({ allowedRoots: ["/repo/omnis"] }))).toHaveLength(
      1,
    );
    expect(await scanCodexSessions(null, 10, deps({ allowedRoots: [] }))).toEqual([]);
  });

  it("orders by mtime, honours max, and drops rollouts not newer than since", async () => {
    const home = await tempCodexHome({
      "sessions/2026/09/21/rollout-2026-09-21T09-00-00-0b6c1d2e-0000-4000-8000-0000000000a1.jsonl":
        [metaLine({ id: "0b6c1d2e-0000-4000-8000-0000000000a1" }), msgLine("user", "older")].join(
          "\n",
        ),
      "sessions/2026/09/22/rollout-2026-09-22T09-00-00-0b6c1d2e-0000-4000-8000-0000000000a2.jsonl":
        [metaLine({ id: "0b6c1d2e-0000-4000-8000-0000000000a2" }), msgLine("user", "newer")].join(
          "\n",
        ),
    });
    const mtimes = new Map([
      [
        join(
          home,
          "sessions/2026/09/21/rollout-2026-09-21T09-00-00-0b6c1d2e-0000-4000-8000-0000000000a1.jsonl",
        ),
        new Date("2026-09-21T00:00:00.000Z"),
      ],
      [
        join(
          home,
          "sessions/2026/09/22/rollout-2026-09-22T09-00-00-0b6c1d2e-0000-4000-8000-0000000000a2.jsonl",
        ),
        new Date("2026-09-22T00:00:00.000Z"),
      ],
    ]);
    const statMtime = async (p: string): Promise<Date> => mtimes.get(p) ?? new Date(0);
    // `/` admits both rollouts, so ordering and the cap are observable.
    const all = deps({ codexHome: home, allowedRoots: ["/"], statMtime });

    expect((await scanCodexSessions(null, 10, all)).map((s) => s.source_id)).toEqual([
      "0b6c1d2e-0000-4000-8000-0000000000a2",
      "0b6c1d2e-0000-4000-8000-0000000000a1",
    ]);
    expect((await scanCodexSessions(null, 1, all)).map((s) => s.source_id)).toEqual([
      "0b6c1d2e-0000-4000-8000-0000000000a2",
    ]);
    expect(
      (await scanCodexSessions(new Date("2026-09-21T12:00:00.000Z"), 10, all)).map(
        (s) => s.source_id,
      ),
    ).toEqual(["0b6c1d2e-0000-4000-8000-0000000000a2"]);
  });

  it("opens only codexHome/sessions/**/rollout-*.jsonl", async () => {
    const opened: string[] = [];
    const violations: string[] = [];
    const readFileSpy = async (p: string): Promise<string> => {
      opened.push(p);
      if (!p.startsWith(SESSIONS + sep) || !p.endsWith(".jsonl")) violations.push(p);
      return readFile(p, "utf8");
    };

    await scanCodexSessions(null, 10, deps({ readFile: readFileSpy }));

    expect(violations).toEqual([]);
    expect(opened).toEqual([ROLLOUT]);
    expect(opened).not.toContain(AUTH);
    expect(opened).not.toContain(HISTORY);
    // The credential decoy has to be on disk and inside `codexHome` for the line above to mean
    // anything: a secret that was never written is one the scanner trivially never opens. This pins
    // the fixture itself, so deleting it fails the containment test instead of hollowing it out.
    expect(await readFile(AUTH, "utf8")).toContain("DECOY-MUST-NOT-BE-READ");
    // `history.jsonl` is the decoy for the *name* filter rather than for the directory: it sits in a
    // real date directory beside the rollout, and a walk widened to any `.jsonl` would import it (it
    // parses, and its cwd is inside the allowed root) without tripping the path rules above. Reading
    // it here proves the decoy is not inert — the same lesson the Claude suite learned the hard way.
    expect(parseCodexRollout(await readFile(HISTORY, "utf8")).cwd).toBe("/repo/omnis");
  });

  it("returns an empty list when the host has no ~/.codex/sessions", async () => {
    expect(
      await scanCodexSessions(null, 10, deps({ codexHome: join(tmpdir(), "omnis-absent-codex") })),
    ).toEqual([]);
  });

  it("masks every string it emits, and decides containment on the unmasked cwd", async () => {
    const home = await mkdtemp(join(tmpdir(), "omnis-codex-import-fields-"));
    const dir = join(home, "sessions", "2026", "09", "21");
    await mkdir(dir, { recursive: true });
    // The session id, the cwd and a tool name are all rollout-supplied strings, and all three reach
    // the hub. A masking pass that covered only `text` would ship them in the clear.
    await writeFile(
      join(dir, "rollout-2026-09-21T10-00-00-0b6c1d2e-0000-4000-8000-0000000000b1.jsonl"),
      [
        metaLine({ id: `sk-${"a".repeat(20)}`, cwd: join(home, KNOWN_SECRET) }),
        msgLine("assistant", "body"),
        callLine(`ghp_${"B".repeat(36)}`),
      ].join("\n"),
    );

    const sessions = await scanCodexSessions(
      null,
      10,
      deps({ codexHome: home, allowedRoots: [home] }),
    );

    // Admitted even though its cwd embeds a secret — containment reads the path the rollout wrote,
    // and masking runs afterwards, on the way out.
    const blob = JSON.stringify(sessions);
    expect(sessions).toHaveLength(1);
    expect(blob).not.toContain(KNOWN_SECRET);
    expect(blob).not.toContain("sk-");
    expect(blob).not.toContain("ghp_");
    expect(sessions[0]?.source_id).toBe("***");
    expect(sessions[0]?.cwd).toBe(join(home, "***"));
    expect(sessions[0]?.turns).toHaveLength(1);
    expect(sessions[0]?.turns[0]?.tool_calls).toEqual(["***"]);
    // Masking must not push any field outside what the hub's schema accepts.
    expect(ImportScanResult.parse({ sessions }).sessions).toHaveLength(1);
  });

  it("drops a rollout whose session_meta never named a cwd", async () => {
    const home = await tempCodexHome({
      // No `session_meta` at all: nothing to key or contain the rollout by, so it is dropped without
      // its turns ever being considered.
      "sessions/2026/09/21/rollout-2026-09-21T09-00-00-0b6c1d2e-0000-4000-8000-0000000000e1.jsonl":
        msgLine("user", "no meta line"),
      // A `session_meta` that simply omits `cwd` is the case that actually reaches masking: the turn
      // still takes the meta timestamp, so only the cwd guard stands between it and `maskSecrets(null)`
      // — which throws *outside* the try that guards the read, taking every other session in the same
      // answer down with it.
      "sessions/2026/09/21/rollout-2026-09-21T09-00-00-0b6c1d2e-0000-4000-8000-0000000000e2.jsonl":
        [metaLine({ cwd: undefined }), msgLine("user", "meta without a cwd")].join("\n"),
    });

    const sessions = await scanCodexSessions(
      null,
      10,
      deps({ codexHome: home, allowedRoots: ["/"] }),
    );

    expect(sessions).toEqual([]);
    expect(ImportScanResult.parse({ sessions }).sessions).toEqual([]);
  });

  it("truncates a turn to the protocol's 1,000-char limit", async () => {
    const home = await tempCodexHome({
      "sessions/2026/09/21/rollout-2026-09-21T10-00-00-0b6c1d2e-0000-4000-8000-0000000000f1.jsonl":
        [metaLine(), msgLine("assistant", "x".repeat(1500))].join("\n"),
    });

    const sessions = await scanCodexSessions(
      null,
      10,
      deps({ codexHome: home, allowedRoots: ["/"] }),
    );

    // `ImportedTurn.text` is `.max(1000)`: an untruncated turn would fail the hub's parse of the whole
    // answer, so the codex scanner has to run the same mask-then-cut pair the Claude one does.
    expect(sessions[0]?.turns[0]?.text).toHaveLength(1000);
    expect(ImportScanResult.parse({ sessions }).sessions).toHaveLength(1);
  });
});

describe("sessions.import_scan over the dispatcher", () => {
  const dispatch = () =>
    createDispatcher({
      registry: new SessionRegistry(),
      token: "test-bridge-token",
      adapters: new Map(),
      allowedRoots: new Map([
        ["claude_code", ["/repo"]],
        ["codex", ["/repo"]],
      ]),
      runtimeIds: new Map(),
      logger: createLogger("@omnis/local-agent", { sink: () => {} }),
      host: "mini",
      claudeHome: CLAUDE_HOME,
      codexHome: CODEX_HOME,
      importSecrets: [KNOWN_SECRET],
    });

  const scan = async (maxSessions: number) =>
    ImportScanResult.parse(
      await dispatch()(
        "sessions.import_scan",
        withMeta({ since: null, max_sessions: maxSessions }),
      ),
    );

  it("merges both scanners newest first and caps at max_sessions", async () => {
    const result = await scan(50);

    // The Codex rollout starts a day after the Claude transcript.
    expect(result.sessions.map((s) => s.runtime)).toEqual(["codex", "claude_code"]);
    expect(result.sessions.map((s) => s.source_id)).toEqual([CODEX_SESSION, CLAUDE_SESSION]);
    expect(JSON.stringify(result)).not.toContain(KNOWN_SECRET);
    expect(JSON.stringify(result)).not.toContain("DECOY-MUST-NOT-BE-READ");

    // The cap is the request's, not each scanner's: 1 keeps the newest of the merged pair.
    expect((await scan(1)).sessions.map((s) => s.source_id)).toEqual([CODEX_SESSION]);
  });
});
