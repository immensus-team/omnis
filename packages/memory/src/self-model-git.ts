// A4 §13.2: 승인된 패치는 self-model git 레포에 git apply + 커밋하고, 메모리 캐시의 스냅샷을
// 무효화한다. 승인 자체(pending_approvals)는 US-B25가 쥔다 — 여기는 승인이 끝난 뒤의 손이다.
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
  "USER.md": "# USER\n\n<!-- 나에 대한 사실. A4 §12.3 상한 1,200 토큰. -->\n",
  "VOICE.md": "# VOICE\n\n<!-- 말투와 샘플. A4 §12.3 상한 1,500 토큰. -->\n",
  "PROJECTS.md": "# PROJECTS\n\n<!-- 진행 중인 일. A4 §12.3 상한 1,500 토큰. -->\n",
};

async function isRepo(dir: string): Promise<boolean> {
  try {
    await run("git", ["-C", dir, "rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/** 없으면 만들고, 있으면 아무것도 덮어쓰지 않는다. 온보딩(US-B34)과 첫 패치 양쪽이 부른다. */
export async function ensureSelfModelRepo(): Promise<string> {
  const dir = selfModelDir();
  await mkdir(dir, { recursive: true });
  if (await isRepo(dir)) return dir;

  await run("git", ["-C", dir, "init", "-q", "-b", "main"]);
  // 전역 git 설정이 없는 머신(CI)에서도 커밋이 되도록 레포 로컬 identity를 박는다.
  await run("git", ["-C", dir, "config", "user.name", "omnis"]);
  await run("git", ["-C", dir, "config", "user.email", "281932556+jinhologankim@users.noreply.github.com"]);
  for (const f of SELF_MODEL_FILES) {
    await writeFile(join(dir, f), SEED[f], { flag: "wx" }).catch(() => undefined);
  }
  await run("git", ["-C", dir, "add", "."]);
  await run("git", ["-C", dir, "commit", "-q", "-m", "self-model: 초기화"]);
  return dir;
}

/** git apply가 파일을 건드리는 경로는 ---/+++ 헤더만이 아니다. rename/copy 섹션은 헤더 없이
 *  `diff --git` + `rename to`만으로 파일을 옮긴다 — 셋 다 모아서 전부 선언한 파일과 대조한다.
 *  diff는 모델이 쓴 것이 들어오므로(US-B25) 모르는 이름이 하나라도 있으면 거부한다. */
function assertDiffTouchesOnly(file: SelfModelFile, diff: string): void {
  const names = [
    // `--- a/USER.md\t2026-09-20 10:00:00` — diff -u가 붙이는 탭+타임스탬프는 이름이 아니다.
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

/** execFile 에러의 message는 커맨드라인을 통째로 물고 있다(= rationale이 로그로 샌다). git이 실제로
 *  한 말만 꺼낸다 — "nothing to commit"은 stdout으로 나오므로 stderr 다음에 stdout을 본다. */
function gitSaid(e: unknown): string {
  const x = e as { stderr?: string; stdout?: string };
  const said = (x?.stderr || x?.stdout || "").trim();
  return said.split("\n")[0] || "exited non-zero";
}

/** rationale은 커밋 제목에 그대로 들어간다(A4 §13.2의 `self-model: {file} — {rationale 요약}`).
 *  80자를 넘으면 자른다 — git 제목 줄이 길면 로그가 읽히지 않는다. */
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
    // 내용이 그대로인 패치면 여기서 "nothing to commit"으로 죽는다 — 계약상 SelfModelPatchError다.
    ({ stdout } = await run("git", ["-C", dir, "rev-parse", "HEAD"]));
  } catch (e) {
    throw new SelfModelPatchError(`git commit failed for ${file}: ${gitSaid(e)}`);
  }

  invalidateSnapshotCache(); // A4 §13.2: 다음 루프 호출부터 새 프리픽스
  return { commit: stdout.trim() };
}
