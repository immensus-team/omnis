// packages/kernel/src/self-model/apply.ts
// A4 §13.2: on approval the kernel runs git apply + commit against the self-model git repo and
// invalidates the snapshot cache.
//
// The plan draft (2026-09-20) had this file doing git apply/commit/cache invalidation itself, but
// US-B02 merged first and moved all three steps into @omnis/memory's applySelfModelPatch()
// (including the check that only one file is touched — self-model-git.ts). Implementing them again
// here would be double maintenance (deviation, YAGNI rung 2). The kernel is the hand that acts
// after approval — checkPatch() takes a dry-run failure quietly and ends without touching the real
// apply; on success it calls applySelfModelPatch and only records the audit.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { applySelfModelPatch, ensureSelfModelRepo } from "@omnis/memory";
import type { Audit } from "../audit.js";

const run = promisify(execFile);

export const SELF_MODEL_DIR_ENV = "OMNIS_SELF_MODEL_DIR";

/** Must resolve to the same path as @omnis/memory's selfModelDir() (same homedir() fallback). */
export function selfModelDir(env: NodeJS.ProcessEnv = process.env): string {
  return env[SELF_MODEL_DIR_ENV] ?? join(env.HOME ?? homedir(), ".omnis", "self-model");
}

/** Checks whether the diff actually applies. On failure the approval goes to failExecution. */
export async function checkPatch(dir: string, diff: string): Promise<boolean> {
  const tmp = await mkdtemp(join(tmpdir(), "omnis-patch-"));
  const file = join(tmp, "patch.diff");
  try {
    await writeFile(file, diff.endsWith("\n") ? diff : `${diff}\n`, "utf8");
    await run("git", ["-C", dir, "apply", "--check", file]);
    return true;
  } catch {
    return false;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function applyApprovedSelfModelPatch(
  args: { file: "USER.md" | "VOICE.md" | "PROJECTS.md"; diff: string; rationale: string },
  deps: { audit: Audit; approvalId: string },
): Promise<{ commit: string }> {
  // The dry-run and the real apply must hit the same repo — the directory comes from
  // @omnis/memory too. (The repo is initialized here when missing — the same function
  // US-B34 onboarding calls first.)
  const dir = await ensureSelfModelRepo();
  if (!(await checkPatch(dir, args.diff))) {
    throw new Error(`git apply --check failed for ${args.file}`);
  }
  // applySelfModelPatch does the real git apply + commit + invalidateSnapshotCache
  // (packages/memory/src/self-model-git.ts) — we do not repeat it here.
  const { commit } = await applySelfModelPatch(args.file, args.diff, args.rationale);
  await deps.audit.record({
    actor: "me",
    action: "self_model.applied",
    target_table: "settings",
    // audit_log.target_id is a uuid (0006). The file name goes into after —
    // same as cost-daily/kill-switch.
    after: { file: args.file, commit, rationale: args.rationale },
    approval_id: deps.approvalId,
  });
  return { commit };
}
