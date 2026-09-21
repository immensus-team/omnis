// US-C14 (C-D7): the bridge's read-only Claude Code session import. Two contracts are under test
// here that the fixture data alone cannot express:
//  ① the scanner opens only `claudeHome/projects/<dir>/<file>.jsonl` — the readFile spy records every
//    path it is handed, so a future change that widens the enumeration fails loudly;
//  ② masking runs *before* the 1,000-char truncation, so a secret straddling the cut is replaced
//    rather than halved into a leak.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { ImportScanResult, withMeta } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import {
  type ImportDeps,
  insideAnyRoot,
  maskSecrets,
  parseClaudeJsonl,
  scanClaudeProjects,
} from "../src/import/claude-jsonl.js";
import { createLogger } from "../src/logger.js";
import { createDispatcher } from "../src/rpc-dispatch.js";
import { SessionRegistry } from "../src/session-registry.js";

const here = new URL(".", import.meta.url).pathname;
const FIXTURE_HOME = join(here, "fixtures", "claude-home");
const PROJECTS = join(FIXTURE_HOME, "projects");
const CREDENTIALS = join(FIXTURE_HOME, ".credentials.json");
const REPO_FILE = join(PROJECTS, "-repo-omnis", "0b6c1d2e-0000-4000-8000-000000000001.jsonl");
const PRIVATE_FILE = join(PROJECTS, "-etc-private", "0b6c1d2e-0000-4000-8000-000000000002.jsonl");
const REPO_SESSION = "0b6c1d2e-0000-4000-8000-000000000001";
const PRIVATE_SESSION = "0b6c1d2e-0000-4000-8000-000000000002";
/** The value the live bridge knows from the keychain — masking it must not depend on its shape. */
const KNOWN_SECRET = "OMNIS_TEST_TOKEN_KNOWN_VALUE";

const deps = (over: Partial<ImportDeps> = {}): ImportDeps => ({
  claudeHome: FIXTURE_HOME,
  codexHome: join(FIXTURE_HOME, "codex"),
  allowedRoots: ["/repo"],
  secrets: [KNOWN_SECRET],
  ...over,
});

describe("maskSecrets", () => {
  it("masks a known secret value, the sk- shape and the ghp_ shape", () => {
    expect(maskSecrets("token sk-abcdefghij0123456789ABCDEF here", [])).toBe("token *** here");
    expect(maskSecrets(`x ghp_${"A".repeat(36)} y`, [])).toBe("x *** y");
    expect(maskSecrets(`known ${KNOWN_SECRET} value`, [KNOWN_SECRET])).toBe("known *** value");
  });

  it("leaves text below the shapes' length floor alone", () => {
    expect(maskSecrets("sk-short and ghp_tiny", [])).toBe("sk-short and ghp_tiny");
  });

  it("ignores an empty known secret instead of wiping the text", () => {
    expect(maskSecrets("nothing to hide", [""])).toBe("nothing to hide");
  });
});

describe("insideAnyRoot", () => {
  it("refuses a cwd that is not absolute", () => {
    // Shared by both scanners (US-C15's Codex scanner imports it). A relative path resolves against
    // the *daemon's* working directory, so containment would be decided against a directory the
    // transcript never named; both vendors record an absolute cwd, so anything else is malformed.
    expect(insideAnyRoot("omnis", [process.cwd()])).toBe(false);
    expect(insideAnyRoot(process.cwd(), [process.cwd()])).toBe(true);
  });
});

describe("parseClaudeJsonl", () => {
  it("keeps user/assistant lines and skips sidechain, malformed and non-turn records", async () => {
    const parsed = parseClaudeJsonl(await readFile(REPO_FILE, "utf8"));

    expect(parsed.cwd).toBe("/repo/omnis");
    expect(parsed.sessionId).toBe(REPO_SESSION);
    expect(parsed.startedAt).toBe("2026-09-20T10:00:00.000Z");
    expect(parsed.turns.map((t) => t.role)).toEqual(["user", "agent", "agent"]);
    expect(parsed.turns.map((t) => t.source_id)).toEqual([
      "a1a1a1a1-0000-4000-8000-000000000001",
      "a1a1a1a1-0000-4000-8000-000000000002",
      "a1a1a1a1-0000-4000-8000-000000000004",
    ]);
    expect(parsed.turns[0]?.text).toBe("Wire the import scanner.");
    expect(parsed.turns[0]?.tool_calls).toEqual([]);
    expect(parsed.turns[1]?.text).toBe("Reading the plan first.");
    expect(parsed.turns[1]?.tool_calls).toEqual(["Read", "Bash"]);
    // The whole file is read even though three of its lines are unusable.
    expect(JSON.stringify(parsed)).not.toContain("Sidechain");
    expect(JSON.stringify(parsed)).not.toContain("provenance");
  });

  it("reports nulls for a file with nothing usable in it", () => {
    expect(parseClaudeJsonl('not JSON\n\n{"type":"summary"}')).toEqual({
      cwd: null,
      sessionId: null,
      startedAt: null,
      turns: [],
    });
  });
});

describe("scanClaudeProjects", () => {
  it("imports the in-root session, masked, and drops the one outside allowed_roots", async () => {
    const sessions = await scanClaudeProjects(null, 10, deps());

    expect(sessions).toHaveLength(1);
    const [session] = sessions;
    expect(session?.runtime).toBe("claude_code");
    expect(session?.source_id).toBe(REPO_SESSION);
    expect(session?.cwd).toBe("/repo/omnis");
    expect(session?.started_at).toBe("2026-09-20T10:00:00.000Z");
    expect(session?.turns.map((t) => t.role)).toEqual(["user", "agent", "agent"]);
    expect(session?.turns[1]?.tool_calls).toEqual(["Read", "Bash"]);

    const masked = session?.turns[2]?.text ?? "";
    expect(masked).toContain("***");
    expect(masked).not.toContain("sk-");
    expect(masked).not.toContain("ghp_");
    expect(masked).not.toContain(KNOWN_SECRET);
    // The decoy never reaches the result by any route.
    expect(JSON.stringify(sessions)).not.toContain("DECOY-MUST-NOT-BE-READ");
    // And what the scanner produced is what the hub will parse (packages/protocol/src/bridge.ts).
    expect(ImportScanResult.parse({ sessions }).sessions).toHaveLength(1);
  });

  it("does not treat a sibling of an allowed root as inside it", async () => {
    expect(await scanClaudeProjects(null, 10, deps({ allowedRoots: ["/rep"] }))).toEqual([]);
    expect(
      await scanClaudeProjects(null, 10, deps({ allowedRoots: ["/repo/omnis"] })),
    ).toHaveLength(1);
    expect(await scanClaudeProjects(null, 10, deps({ allowedRoots: [] }))).toEqual([]);
  });

  it("orders by mtime, honours max, and drops sessions not newer than since", async () => {
    const mtimes = new Map([
      [REPO_FILE, new Date("2026-09-21T00:00:00.000Z")],
      [PRIVATE_FILE, new Date("2026-09-22T00:00:00.000Z")],
    ]);
    const statMtime = async (p: string): Promise<Date> => mtimes.get(p) ?? new Date(0);
    // `/` admits both fixtures, so ordering and the cap are observable.
    const all = deps({ allowedRoots: ["/"], statMtime });

    expect((await scanClaudeProjects(null, 10, all)).map((s) => s.source_id)).toEqual([
      PRIVATE_SESSION,
      REPO_SESSION,
    ]);
    expect((await scanClaudeProjects(null, 1, all)).map((s) => s.source_id)).toEqual([
      PRIVATE_SESSION,
    ]);
    expect(
      (await scanClaudeProjects(new Date("2026-09-21T12:00:00.000Z"), 10, all)).map(
        (s) => s.source_id,
      ),
    ).toEqual([PRIVATE_SESSION]);
  });

  it("opens only claudeHome/projects/**/*.jsonl", async () => {
    const opened: string[] = [];
    const violations: string[] = [];
    const readFileSpy = async (p: string): Promise<string> => {
      opened.push(p);
      if (!p.startsWith(PROJECTS + sep) || !p.endsWith(".jsonl")) violations.push(p);
      return readFile(p, "utf8");
    };

    await scanClaudeProjects(null, 10, deps({ readFile: readFileSpy }));

    expect(violations).toEqual([]);
    expect(opened).toHaveLength(2);
    expect(opened).not.toContain(CREDENTIALS);
    // The decoy has to be on disk and inside `claudeHome` for the line above to mean anything: a
    // credential that was never written is one the scanner trivially never opens. This pins the
    // fixture itself, so deleting it fails the containment test instead of hollowing it out.
    expect(await readFile(CREDENTIALS, "utf8")).toContain("DECOY-MUST-NOT-BE-READ");
  });

  it("returns an empty list when the host has no ~/.claude/projects", async () => {
    expect(
      await scanClaudeProjects(null, 10, deps({ claudeHome: join(tmpdir(), "omnis-absent-home") })),
    ).toEqual([]);
  });

  it("masks a turn before truncating it to 1,000 chars", async () => {
    const home = await mkdtemp(join(tmpdir(), "omnis-claude-import-"));
    const dir = join(home, "projects", "-repo-omnis");
    await mkdir(dir, { recursive: true });
    // The secret starts at char 981, so truncating first would leak its first 20 characters.
    const text = `${"x".repeat(980)}${KNOWN_SECRET}${"y".repeat(100)}`;
    await writeFile(
      join(dir, "s.jsonl"),
      JSON.stringify({
        type: "user",
        uuid: "c3c3c3c3-0000-4000-8000-000000000001",
        sessionId: "c3c3c3c3-0000-4000-8000-000000000001",
        timestamp: "2026-09-20T10:00:00.000Z",
        cwd: home,
        message: { role: "user", content: text },
      }),
    );

    const sessions = await scanClaudeProjects(
      null,
      10,
      deps({ claudeHome: home, allowedRoots: [home] }),
    );

    const turnText = sessions[0]?.turns[0]?.text ?? "";
    expect(turnText).toHaveLength(1000);
    expect(turnText.startsWith(`${"x".repeat(980)}***`)).toBe(true);
    expect(turnText).not.toContain(KNOWN_SECRET.slice(0, 20));
  });

  it("masks every string it emits, not only the turn text", async () => {
    const home = await mkdtemp(join(tmpdir(), "omnis-claude-import-fields-"));
    const dir = join(home, "projects", "-repo-omnis");
    await mkdir(dir, { recursive: true });
    // The session id, the cwd and a tool name are all attacker-influenced strings from the transcript,
    // and all three reach the hub. A masking pass that covered only `text` would ship them in the clear.
    const sk = `sk-${"a".repeat(20)}`;
    const ghp = `ghp_${"B".repeat(36)}`;
    const line = (over: Record<string, unknown>) =>
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-09-20T10:00:00.000Z",
        cwd: join(home, KNOWN_SECRET),
        message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: ghp }] },
        ...over,
      });
    await writeFile(
      join(dir, "s.jsonl"),
      [
        line({ uuid: sk, sessionId: sk }),
        line({ uuid: "c3c3c3c3-0000-4000-8000-000000000009", sessionId: sk }),
      ].join("\n"),
    );

    const sessions = await scanClaudeProjects(
      null,
      10,
      deps({ claudeHome: home, allowedRoots: [home] }),
    );

    const blob = JSON.stringify(sessions);
    expect(blob).not.toContain(KNOWN_SECRET);
    expect(blob).not.toContain(sk);
    expect(blob).not.toContain(ghp);
    expect(sessions[0]?.source_id).toBe("***");
    expect(sessions[0]?.cwd).toBe(join(home, "***"));
    expect(sessions[0]?.turns[0]?.tool_calls).toEqual(["***"]);
    // Masking must not push any field outside what the hub's schema accepts.
    expect(ImportScanResult.parse({ sessions }).sessions).toHaveLength(1);
  });

  it("drops a transcript it cannot key instead of emitting an unparseable session", async () => {
    const home = await mkdtemp(join(tmpdir(), "omnis-claude-import-nokey-"));
    const dir = join(home, "projects", "-repo-omnis");
    await mkdir(dir, { recursive: true });
    // No `sessionId` anywhere, in a file named exactly `.jsonl`: the filename fallback is the empty
    // string, and `source_id` is `.min(1)` — so one such file would fail the hub's parse of the lot.
    await writeFile(
      join(dir, ".jsonl"),
      JSON.stringify({
        type: "user",
        uuid: "c3c3c3c3-0000-4000-8000-00000000000f",
        timestamp: "2026-09-20T10:00:00.000Z",
        cwd: home,
        message: { role: "user", content: "body" },
      }),
    );

    const sessions = await scanClaudeProjects(
      null,
      10,
      deps({ claudeHome: home, allowedRoots: [home] }),
    );

    expect(sessions).toEqual([]);
    expect(ImportScanResult.parse({ sessions }).sessions).toEqual([]);
  });
});

describe("sessions.import_scan over the dispatcher", () => {
  const dispatch = () =>
    createDispatcher({
      registry: new SessionRegistry(),
      token: "test-bridge-token",
      adapters: new Map(),
      allowedRoots: new Map([["claude_code", ["/repo"]]]),
      runtimeIds: new Map(),
      logger: createLogger("@omnis/local-agent", { sink: () => {} }),
      host: "mini",
      claudeHome: FIXTURE_HOME,
      // US-C15 added the Codex scanner to this same method. Without a `codexHome` here the scan would
      // reach the developer's real `~/.codex/sessions`, so this test pins an absent one (the path the
      // `deps()` helper above already treats as "no Codex on this host").
      codexHome: join(FIXTURE_HOME, "codex"),
      importSecrets: [KNOWN_SECRET],
    });

  it("returns an ImportScanResult for the host's allowed_roots", async () => {
    const result = ImportScanResult.parse(
      await dispatch()("sessions.import_scan", withMeta({ since: null, max_sessions: 50 })),
    );

    expect(result.sessions.map((s) => s.source_id)).toEqual([REPO_SESSION]);
    expect(result.sessions[0]?.turns[2]?.text).not.toContain(KNOWN_SECRET);
    expect(JSON.stringify(result)).not.toContain("DECOY-MUST-NOT-BE-READ");
  });

  it("rejects a request that omits since", async () => {
    await expect(
      dispatch()("sessions.import_scan", withMeta({ max_sessions: 10 })),
    ).rejects.toThrow();
  });
});
