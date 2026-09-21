// A4 §13.2: an approved patch is git applied + committed into the self-model git repo, and the
// memory cache's snapshot is invalidated. The approval itself (pending_approvals) is held by
// US-B25 — this is the hand that runs once approval is done.
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  SELF_MODEL_FILES,
  type SelfModelFile,
  invalidateSnapshotCache,
  selfModelDir,
} from "./self-model.js";

const run = promisify(execFile);

export class SelfModelPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelfModelPatchError";
  }
}

const SEED: Record<SelfModelFile, string> = {
  "USER.md": "# USER\n\n<!-- Facts about me. A4 §12.3 cap 1,200 tokens. -->\n",
  "VOICE.md": "# VOICE\n\n<!-- Voice and samples. A4 §12.3 cap 1,500 tokens. -->\n",
  "PROJECTS.md": "# PROJECTS\n\n<!-- Work in progress. A4 §12.3 cap 1,500 tokens. -->\n",
};

async function isRepo(dir: string): Promise<boolean> {
  try {
    await run("git", ["-C", dir, "rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/** Creates it when missing; when present, overwrites nothing. Called by both onboarding (US-B34)
 *  and the first patch. */
export async function ensureSelfModelRepo(): Promise<string> {
  const dir = selfModelDir();
  await mkdir(dir, { recursive: true });
  if (await isRepo(dir)) return dir;

  await run("git", ["-C", dir, "init", "-q", "-b", "main"]);
  // Pins a repo-local identity so commits work even on machines without a global git config (CI).
  await run("git", ["-C", dir, "config", "user.name", "omnis"]);
  await run("git", ["-C", dir, "config", "user.email", "omnis@localhost"]);
  for (const f of SELF_MODEL_FILES) {
    await writeFile(join(dir, f), SEED[f], { flag: "wx" }).catch(() => undefined);
  }
  await run("git", ["-C", dir, "add", "."]);
  await run("git", ["-C", dir, "commit", "-q", "-m", "self-model: initialize"]);
  return dir;
}

/** The paths a git apply touches are not only in the ---/+++ headers. rename/copy sections move a
 *  file with just `diff --git` + `rename to` and no headers — all three are collected and checked
 *  against the declared file. The diff comes from the model (US-B25), so a single unknown name is
 *  grounds for rejection. */
function assertDiffTouchesOnly(file: SelfModelFile, diff: string): void {
  const names = [
    // `--- a/USER.md\t2026-09-20 10:00:00` — the tab+timestamp diff -u appends is not part of the name.
    ...[...diff.matchAll(/^(?:---|\+\+\+) [ab]\/([^\t\r\n]+)/gm)].map((m) => m[1]),
    ...[...diff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].flatMap((m) => [m[1], m[2]]),
    ...[...diff.matchAll(/^(?:rename|copy) (?:from|to) (.+)$/gm)].map((m) => m[1]),
  ];
  if (names.length === 0) throw new SelfModelPatchError("diff has no ---/+++ headers");
  for (const n of names) {
    if (n !== file) {
      throw new SelfModelPatchError(`diff touches ${n}, not the declared file ${file}`);
    }
  }
}

/** An execFile error's message swallows the whole command line (= the rationale leaks into the
 *  logs). Only what git actually said is extracted — "nothing to commit" goes to stdout, so stdout
 *  is read after stderr. */
function gitSaid(e: unknown): string {
  const x = e as { stderr?: string; stdout?: string };
  const said = (x?.stderr || x?.stdout || "").trim();
  return said.split("\n")[0] || "exited non-zero";
}

/** The rationale goes verbatim into the commit subject (A4 §13.2's `self-model: {file} — {rationale summary}`).
 *  It is truncated past 80 characters — a long git subject line makes the log unreadable. */
export async function applySelfModelPatch(
  file: SelfModelFile,
  diff: string,
  rationale: string,
): Promise<{ commit: string }> {
  assertDiffTouchesOnly(file, diff);
  const dir = await ensureSelfModelRepo();
  const patchPath = join(dir, ".omnis-patch.diff");
  await writeFile(patchPath, diff.endsWith("\n") ? diff : `${diff}\n`, "utf8");

  try {
    await run("git", ["-C", dir, "apply", "--whitespace=nowarn", patchPath]);
  } catch (e) {
    throw new SelfModelPatchError(`git apply failed for ${file}: ${gitSaid(e)}`);
  } finally {
    await rm(patchPath, { force: true });
  }

  const subject = `self-model: ${file} — ${rationale.slice(0, 80)}`;
  let stdout: string;
  try {
    await run("git", ["-C", dir, "add", file]);
    await run("git", ["-C", dir, "commit", "-q", "-m", subject]);
    // A patch with unchanged content dies here on "nothing to commit" — per contract that is a SelfModelPatchError.
    ({ stdout } = await run("git", ["-C", dir, "rev-parse", "HEAD"]));
  } catch (e) {
    throw new SelfModelPatchError(`git commit failed for ${file}: ${gitSaid(e)}`);
  }

  invalidateSnapshotCache(); // A4 §13.2: a new prefix from the next loop call onward
  return { commit: stdout.trim() };
}
