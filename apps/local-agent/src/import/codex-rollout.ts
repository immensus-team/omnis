// US-C15 (C-D7): read-only import of Codex CLI rollouts, pulled by the hub — the sibling of
// `claude-jsonl.ts`, and deliberately the same shape: enumerate one vendor directory, read only the
// files it names, keep the sessions whose cwd is inside this host's allowed_roots, mask on the way out.
// A cwd that is not absolute is refused rather than resolved against the daemon's own directory — the
// rule lives in `insideAnyRoot`, so both scanners share it.
//
// The bridge opens exactly one path shape — `codexHome/sessions/**/rollout-*.jsonl`, which in practice
// sits `<YYYY>/<MM>/<DD>/` deep but is walked at any depth — and never enumerates `codexHome` itself,
// so `.codex/auth.json` (Codex's subscription credential) is unreachable by construction rather than
// by a blocklist.
//
// The record shapes this parses are the ones the plan states and are UNVERIFIED until US-C29's live
// check: `session_meta` carries the session's id/cwd/time, `response_item` carries messages and
// function calls, and every other record type is skipped, not fatal — the format belongs to a vendor
// that is free to add record types we have never seen.
import type { Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ImportedSession, ImportedTurn } from "@omnis/protocol";
import {
  type ImportDeps,
  asIso,
  asString,
  insideAnyRoot,
  maskSecrets,
  parseLine,
  turnForImport,
} from "./claude-jsonl.js";

type JsonObject = Record<string, unknown>;

/** `payload` is only read when it is a plain object; `null` and arrays are not records. */
function asObject(v: unknown): JsonObject | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as JsonObject) : null;
}

/** `response_item.payload.content`: the parts Codex writes carry the text in `input_text`/`output_text`. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content as unknown[]) {
    const p = asObject(part);
    if (p === null) continue;
    if ((p.type === "input_text" || p.type === "output_text") && typeof p.text === "string")
      parts.push(p.text);
  }
  return parts.join("\n");
}

/**
 * The turn text is returned **unmasked**: masking and truncation are the scanner's job, and the order
 * between them matters (mask first — see `scanCodexSessions`).
 *
 * `session_meta` is assumed to come first, so a message without a timestamp can fall back to it —
 * which is also what `startedAt` ends up being in that case. A rollout with no readable turn at all,
 * or a turn with no timestamp to fall back to, has `startedAt === null` and is dropped by the scanner.
 *
 * `fallbackId` is the rollout file's own identity, and it is required rather than defaulted: without a
 * session id every rollout would otherwise produce the same turn keys, and a constant default is
 * exactly how that collision would come back. Only an id-less `session_meta` ever uses it.
 */
export function parseCodexRollout(
  text: string,
  fallbackId: string,
): {
  cwd: string | null;
  sessionId: string | null;
  startedAt: string | null;
  turns: ImportedTurn[];
} {
  let cwd: string | null = null;
  let sessionId: string | null = null;
  let metaAt: string | null = null;
  const turns: ImportedTurn[] = [];
  // A `function_call` is its own record, so its name waits here until it has a turn to belong to:
  // the last agent turn if there is one (the call follows the message that asked for it), otherwise
  // the next agent turn. A name with no turn on either side never reaches the result.
  const pending: string[] = [];

  for (const raw of text.split("\n")) {
    const line = parseLine(raw);
    if (line === null) continue;

    if (line.type === "session_meta") {
      const payload = asObject(line.payload);
      if (payload === null) continue;
      cwd ??= asString(payload.cwd);
      sessionId ??= asString(payload.id);
      metaAt ??= asIso(payload.timestamp);
      continue;
    }
    if (line.type !== "response_item") continue; // every other record type, the fixture's own included

    const payload = asObject(line.payload);
    if (payload === null) continue;

    if (payload.type === "function_call") {
      const name = asString(payload.name);
      if (name === null) continue;
      const last = turns[turns.length - 1];
      if (last !== undefined && last.role === "agent") last.tool_calls.push(name);
      else pending.push(name);
      continue;
    }
    if (payload.type !== "message") continue; // reasoning, function_call_output, …

    const role = payload.role === "user" ? "user" : payload.role === "assistant" ? "agent" : null;
    if (role === null) continue;
    const at = asIso(line.timestamp) ?? asIso(payload.timestamp) ?? metaAt;
    if (at === null) continue; // `ImportedTurn.at` is a required datetime
    turns.push({
      // Codex message records are not assumed to carry an id; the pass below keys them by position.
      // An id that *does* appear is kept verbatim, so its uniqueness is the vendor's to guarantee.
      source_id: asString(payload.id) ?? "",
      role,
      at,
      text: textOf(payload.content),
      tool_calls: role === "agent" ? pending.splice(0) : [],
    });
  }

  turns.forEach((turn, index) => {
    // Stable across re-imports (the hub dedupes on the turn key) and unique across the rollouts of a
    // host, not merely within one: the prefix is the vendor's session id when it supplied one, and the
    // rollout file's identity otherwise. A bare `codex:<index>` would be the same key in every id-less
    // rollout, and the hub's item dedupe is not scoped to a single session.
    //
    // Two ways a key can still repeat, both UNVERIFIED until US-C29's live check decides them, and
    // both left as they are for now because each fix trades one guess for another:
    //   - an id the vendor does supply is taken verbatim, so a per-conversation `msg_0` would repeat
    //     across files. The plan assumes message records carry no id at all.
    //   - two rollout files sharing one `session_meta.id` — the shape a resumed session would take —
    //     both start again at index 0. If the second file replays the first, that repeat is the
    //     dedupe we want; file-scoped keys would import the replayed turns twice instead.
    if (turn.source_id.length === 0) turn.source_id = `${sessionId ?? fallbackId}:${index}`;
  });

  // A rollout with nothing readable in it is not a session — same rule as the Claude scanner.
  return { cwd, sessionId, startedAt: turns[0]?.at ?? null, turns };
}

/** Collects `rollout-*.jsonl` under `dir`. Symlinked entries are skipped (`isDirectory()` is false for
 *  them), so the walk cannot be led out of `codexHome/sessions` by a link. */
async function collectRollouts(dir: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collectRollouts(path, out);
    else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl"))
      out.push(path);
  }
}

export async function scanCodexSessions(
  since: Date | null,
  max: number,
  deps: ImportDeps,
): Promise<ImportedSession[]> {
  if (max <= 0) return [];
  const read = deps.readFile ?? ((p: string) => readFile(p, "utf8"));
  const mtime = deps.statMtime ?? (async (p: string) => (await stat(p)).mtime);
  const sinceMs = since === null ? null : since.getTime();

  const paths: string[] = [];
  await collectRollouts(join(deps.codexHome, "sessions"), paths);

  const found: { session: ImportedSession; mtimeMs: number }[] = [];
  for (const path of paths) {
    // The rollout's own identity, and the fallback for both the session key and its turn keys. The
    // walk admits `rollout-*.jsonl` only, so the stem is never empty; the uuid in it keeps it unique.
    const fileId = basename(path, ".jsonl");
    let mtimeMs: number;
    let text: string;
    try {
      mtimeMs = (await mtime(path)).getTime();
      if (sinceMs !== null && mtimeMs <= sinceMs) continue;
      text = await read(path); // the only read this module performs, and always a rollout file
    } catch {
      continue; // a file that vanished or is unreadable between listing and opening
    }
    const parsed = parseCodexRollout(text, fileId);
    if (parsed.cwd === null || parsed.startedAt === null) continue;
    // Containment is decided on the rollout's own cwd, before masking rewrites it for the item.
    if (!insideAnyRoot(parsed.cwd, deps.allowedRoots)) continue;
    found.push({
      session: {
        runtime: "codex",
        // The filename is `rollout-<timestamp>-<uuid>.jsonl` and always non-empty: the walk admits
        // only names with the `rollout-` prefix, so `source_id` (`.min(1)`) can never come out blank.
        source_id: maskSecrets(parsed.sessionId ?? fileId, deps.secrets),
        // Masked like the turn text: any rollout-supplied string that reaches the hub is a channel.
        cwd: maskSecrets(parsed.cwd, deps.secrets),
        started_at: parsed.startedAt,
        turns: parsed.turns.map((t) => turnForImport(t, deps.secrets)),
      },
      mtimeMs,
    });
  }

  // Newest first: the hub caps what it imports, and the freshest sessions are the ones worth having.
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, max).map((f) => f.session);
}
