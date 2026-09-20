// packages/kernel/src/self-model/apply.ts
// A4 §13.2: 승인 시 커널이 self-model git 레포에 git apply + 커밋하고 스냅샷 캐시를 무효화한다.
//
// 계획 초안(2026-09-20)은 이 파일이 git apply/commit/캐시 무효화를 직접 하는 것으로 적었지만,
// US-B02가 먼저 머지되면서 그 세 단계가 전부 @omnis/memory의 applySelfModelPatch() 안으로
// 들어갔다(파일 하나만 건드리는지 검사까지 포함 — self-model-git.ts). 여기서 또 구현하면
// 이중 관리다(deviation, YAGNI 2단). 커널은 승인 이후의 손 — checkPatch()로 dry-run
// 실패를 조용히 받아 실제 apply를 건드리지 않고 끝내고, 성공하면 applySelfModelPatch를
// 부르고 audit만 남긴다.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { applySelfModelPatch, ensureSelfModelRepo } from "@omnis/memory";
import type { Audit } from "../audit.js";

const run = promisify(execFile);

export const SELF_MODEL_DIR_ENV = "OMNIS_SELF_MODEL_DIR";

/** @omnis/memory의 selfModelDir()와 같은 경로를 가리켜야 한다(HOME이 비어도 homedir()로 같다). */
export function selfModelDir(env: NodeJS.ProcessEnv = process.env): string {
  return env[SELF_MODEL_DIR_ENV] ?? join(env.HOME ?? homedir(), ".omnis", "self-model");
}

/** diff가 실제로 적용 가능한지 먼저 본다. 실패하면 승인은 failExecution으로 간다. */
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
  // dry-run과 실제 apply는 반드시 같은 레포여야 한다 — 디렉터리도 @omnis/memory에서 받는다.
  // (레포가 아직 없으면 여기서 초기화된다 — US-B34 온보딩이 먼저 부르는 그 함수다.)
  const dir = await ensureSelfModelRepo();
  if (!(await checkPatch(dir, args.diff))) {
    throw new Error(`git apply --check failed for ${args.file}`);
  }
  // applySelfModelPatch가 실제 git apply + commit + invalidateSnapshotCache를 전부 한다
  // (packages/memory/src/self-model-git.ts) — 여기서 다시 하지 않는다.
  const { commit } = await applySelfModelPatch(args.file, args.diff, args.rationale);
  await deps.audit.record({
    actor: "me",
    action: "self_model.applied",
    target_table: "settings",
    // audit_log.target_id는 uuid다(0006). 파일 이름은 after로 간다 — cost-daily/kill-switch와 같다.
    after: { file: args.file, commit, rationale: args.rationale },
    approval_id: deps.approvalId,
  });
  return { commit };
}
