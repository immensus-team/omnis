// US-C14 (C-D7): read-only import of Claude Code terminal transcripts, pulled by the hub.
//
// The bridge opens exactly one path shape — `claudeHome/projects/<dir>/<file>.jsonl` — and never
// enumerates `claudeHome` itself, so `.credentials.json` is unreachable by construction rather than
// by a blocklist (the Phase B prohibition on reading subscription credentials).
//
// Sessions are contained by *resolved* path, never `realpath`: a past session's cwd usually no longer
// exists, and nothing under it is opened anyway — only the transcript file itself is read.
import type { Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import type { ImportedSession, ImportedTurn } from "@omnis/protocol";

/** `ImportedTurn.text` is `.max(1000)` in packages/protocol/src/bridge.ts; keep the two in step. */
export const IMPORT_TURN_MAX_CHARS = 1000;

export interface ImportDeps {
  claudeHome: string;
  codexHome: string;
  allowedRoots: string[];
  secrets: string[];
  readFile?: (p: string) => Promise<string>;
  statMtime?: (p: string) => Promise<Date>;
}

/** `sk-…` keys and GitHub PATs are the two shapes worth catching without knowing the value (A2 §7.2). */
const SK_PATTERN = /sk-[A-Za-z0-9_-]{20,}/g;
const GHP_PATTERN = /ghp_[A-Za-z0-9]{36}/g;

export function maskSecrets(s: string, secrets: string[]): string {
  let out = s;
  for (const secret of secrets) {
    // An empty needle would match between every character, so a blank entry is not a secret.
    if (secret.length === 0) continue;
    // split/join, not RegExp: a keychain value is literal text, whatever it looks like.
    out = out.split(secret).join("***");
  }
  return out.replace(SK_PATTERN, "***").replace(GHP_PATTERN, "***");
}

type JsonObject = Record<string, unknown>;

/**
 * The small helpers below are shared with `codex-rollout.ts` (US-C15) — both scanners read a vendor's
 * jsonl into the same `ImportedSession` shape, and the masking order in `turnForImport` is the part
 * that must never drift between them. Editing one of these edits the Codex scanner too.
 */
export function parseLine(line: string): JsonObject | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as JsonObject)
      : null;
  } catch {
    return null; // a malformed line is skipped, never fatal — real transcripts get truncated mid-write
  }
}

export const asString = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/** A turn with an unparseable timestamp cannot satisfy `ImportedTurn.at: z.string().datetime()`. */
export function asIso(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** `message.content`: a bare string, or the parts array Claude Code writes for assistant turns. */
function textOf(message: unknown): string {
  const content =
    typeof message === "object" && message !== null ? (message as JsonObject).content : undefined;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content as unknown[]) {
    if (typeof part !== "object" || part === null) continue;
    const p = part as JsonObject;
    if (p.type === "text" && typeof p.text === "string" && p.text.length > 0) parts.push(p.text);
  }
  return parts.join("\n");
}

function toolNamesOf(message: unknown): string[] {
  const content =
    typeof message === "object" && message !== null ? (message as JsonObject).content : undefined;
  if (!Array.isArray(content)) return [];
  const names: string[] = [];
  for (const part of content as unknown[]) {
    if (typeof part !== "object" || part === null) continue;
    const p = part as JsonObject;
    if (p.type === "tool_use" && typeof p.name === "string" && p.name.length > 0)
      names.push(p.name);
  }
  return names;
}

/** The turn text is returned **unmasked**: masking and truncation are the scanner's job, and the order
 *  between them matters (mask first — see `scanClaudeProjects`). */
export function parseClaudeJsonl(text: string): {
  cwd: string | null;
  sessionId: string | null;
  startedAt: string | null;
  turns: ImportedTurn[];
} {
  let cwd: string | null = null;
  let sessionId: string | null = null;
  const turns: ImportedTurn[] = [];

  for (const raw of text.split("\n")) {
    const line = parseLine(raw);
    if (line === null) continue;
    cwd ??= asString(line.cwd);
    sessionId ??= asString(line.sessionId);
    if (line.type !== "user" && line.type !== "assistant") continue;
    if (line.isSidechain === true) continue; // a sub-agent's turns are not part of this session's story
    const at = asIso(line.timestamp);
    const sourceId = asString(line.uuid);
    if (at === null || sourceId === null) continue;
    turns.push({
      source_id: sourceId,
      role: line.type === "user" ? "user" : "agent",
      at,
      text: textOf(line.message),
      tool_calls: toolNamesOf(line.message),
    });
  }

  return { cwd, sessionId, startedAt: turns[0]?.at ?? null, turns };
}

export function insideAnyRoot(cwd: string, roots: string[]): boolean {
  // A relative cwd is resolved against the *daemon's* working directory, so containment would be
  // decided against a location the transcript never named — and the emitted item would carry a
  // relative path, which every later check resolves somewhere else again. Both vendors record an
  // absolute cwd, so anything else is malformed input: refuse it rather than guess a base.
  if (!isAbsolute(cwd)) return false;
  const resolved = resolve(cwd);
  return roots.some((root) => {
    const r = resolve(root);
    return resolved === r || resolved.startsWith(r.endsWith(sep) ? r : r + sep);
  });
}

/** The mask/truncate pair, in that order: cutting first would leave the head of a secret in the item. */
export function turnForImport(turn: ImportedTurn, secrets: string[]): ImportedTurn {
  return {
    ...turn,
    // Every string here is transcript-supplied and reaches the hub, so all of them are masked. Doing
    // only `text` would leave `source_id` (the line's uuid) as a clear channel for a smuggled token.
    source_id: maskSecrets(turn.source_id, secrets),
    text: maskSecrets(turn.text, secrets).slice(0, IMPORT_TURN_MAX_CHARS),
    tool_calls: turn.tool_calls.map((name) => maskSecrets(name, secrets)),
  };
}

export async function scanClaudeProjects(
  since: Date | null,
  max: number,
  deps: ImportDeps,
): Promise<ImportedSession[]> {
  if (max <= 0) return [];
  const read = deps.readFile ?? ((p: string) => readFile(p, "utf8"));
  const mtime = deps.statMtime ?? (async (p: string) => (await stat(p)).mtime);
  const projectsDir = join(deps.claudeHome, "projects");
  const sinceMs = since === null ? null : since.getTime();

  let projectDirs: Dirent[];
  try {
    projectDirs = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return []; // no ~/.claude/projects on this host is not an error, it is an empty import
  }

  const found: { session: ImportedSession; mtimeMs: number }[] = [];
  for (const dir of projectDirs) {
    if (!dir.isDirectory()) continue; // this also skips symlinked entries
    const childDir = join(projectsDir, dir.name);
    let files: Dirent[];
    try {
      files = await readdir(childDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const path = join(childDir, file.name);
      let mtimeMs: number;
      let text: string;
      try {
        mtimeMs = (await mtime(path)).getTime();
        if (sinceMs !== null && mtimeMs <= sinceMs) continue;
        text = await read(path); // the only read this module performs, and always inside projectsDir
      } catch {
        continue; // a file that vanished or is unreadable between listing and opening
      }
      const parsed = parseClaudeJsonl(text);
      if (parsed.cwd === null || parsed.startedAt === null) continue;
      // Containment is decided on the transcript's own cwd, before masking rewrites it for the item.
      if (!insideAnyRoot(parsed.cwd, deps.allowedRoots)) continue;
      // The session id lives in the file, but the filename is the same id — trust the file first.
      const sourceId = maskSecrets(parsed.sessionId ?? basename(file.name, ".jsonl"), deps.secrets);
      // A transcript with no `sessionId` in a file named exactly `.jsonl` leaves no key at all, and
      // `ImportedSession.source_id` is `.min(1)`: one empty id would fail the *whole* result parse
      // on the hub, taking every other session down with it. Unkeyable means unimportable.
      if (sourceId.length === 0) continue;
      found.push({
        session: {
          runtime: "claude_code",
          source_id: sourceId,
          // Masked like the turn text: any transcript-supplied string that reaches the hub is a channel.
          cwd: maskSecrets(parsed.cwd, deps.secrets),
          started_at: parsed.startedAt,
          turns: parsed.turns.map((t) => turnForImport(t, deps.secrets)),
        },
        mtimeMs,
      });
    }
  }

  // Newest first: the hub caps what it imports, and the freshest sessions are the ones worth having.
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, max).map((f) => f.session);
}
