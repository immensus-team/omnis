import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SelfModelPatchError,
  applySelfModelPatch,
  ensureSelfModelRepo,
} from "../src/self-model-git.js";
import { invalidateSnapshotCache, loadSelfModel } from "../src/self-model.js";

const run = promisify(execFile);
let dir: string;
const originalDir = process.env.OMNIS_SELF_MODEL_DIR;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omnis-self-model-git-"));
  process.env.OMNIS_SELF_MODEL_DIR = dir;
  invalidateSnapshotCache();
});
afterEach(() => {
  // biome lint/performance/noDelete를 피하면서 실제로 키를 지운다(= "undefined" 문자열을 남기지 않는다).
  if (originalDir === undefined) Reflect.deleteProperty(process.env, "OMNIS_SELF_MODEL_DIR");
  else process.env.OMNIS_SELF_MODEL_DIR = originalDir;
  invalidateSnapshotCache();
});

const PATCH = `--- a/USER.md
+++ b/USER.md
@@ -1,2 +1,2 @@
 # Logan
-서울에서 일한다.
+서울에서 일하고, 화요일엔 재택한다.
`;

describe("ensureSelfModelRepo", () => {
  it("initialises a git repo with the three files and one commit", async () => {
    const repo = await ensureSelfModelRepo();
    expect(repo).toBe(dir);
    const { stdout } = await run("git", ["-C", dir, "log", "--oneline"]);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    for (const f of ["USER.md", "VOICE.md", "PROJECTS.md"]) {
      expect(await readFile(join(dir, f), "utf8")).toContain(f.replace(".md", ""));
    }
  });

  it("is idempotent — a second call adds no commit and overwrites nothing", async () => {
    await ensureSelfModelRepo();
    await writeFile(join(dir, "USER.md"), "# Logan\n내가 쓴 내용\n");
    await ensureSelfModelRepo();
    expect(await readFile(join(dir, "USER.md"), "utf8")).toContain("내가 쓴 내용");
    const { stdout } = await run("git", ["-C", dir, "log", "--oneline"]);
    expect(stdout.trim().split("\n")).toHaveLength(1);
  });
});

describe("applySelfModelPatch", () => {
  it("applies the diff, commits it, and returns the commit sha", async () => {
    await ensureSelfModelRepo();
    await writeFile(join(dir, "USER.md"), "# Logan\n서울에서 일한다.\n");
    await run("git", ["-C", dir, "commit", "-am", "seed"]);

    const { commit } = await applySelfModelPatch("USER.md", PATCH, "화요일 재택을 반영");
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(join(dir, "USER.md"), "utf8")).toContain("화요일엔 재택한다");

    const { stdout } = await run("git", ["-C", dir, "log", "-1", "--format=%s"]);
    expect(stdout.trim()).toBe("self-model: USER.md — 화요일 재택을 반영");
  });

  // A4 §13.2: 패치 적용은 캐시를 한 번 비운다. 안 비우면 다음 루프가 옛 프리픽스를 계속 쓴다.
  it("invalidates the snapshot cache so the next load sees the new text", async () => {
    await ensureSelfModelRepo();
    await writeFile(join(dir, "USER.md"), "# Logan\n서울에서 일한다.\n");
    await run("git", ["-C", dir, "commit", "-am", "seed"]);
    const before = await loadSelfModel(["USER.md"]);

    await applySelfModelPatch("USER.md", PATCH, "화요일 재택을 반영");
    const after = await loadSelfModel(["USER.md"]);
    expect(after.sha256).not.toBe(before.sha256);
    expect(after.files["USER.md"]).toContain("재택");
  });

  it("throws SelfModelPatchError and leaves the file untouched when the diff does not apply", async () => {
    await ensureSelfModelRepo();
    await writeFile(join(dir, "USER.md"), "# Logan\n전혀 다른 줄\n");
    await run("git", ["-C", dir, "commit", "-am", "seed"]);

    await expect(applySelfModelPatch("USER.md", PATCH, "안 맞는 패치")).rejects.toThrow(
      SelfModelPatchError,
    );
    expect(await readFile(join(dir, "USER.md"), "utf8")).toContain("전혀 다른 줄");
  });

  it("refuses a diff that touches a file other than the declared one", async () => {
    await ensureSelfModelRepo();
    const sneaky = PATCH.replace(/USER\.md/g, "VOICE.md");
    await expect(applySelfModelPatch("USER.md", sneaky, "경로 바꿔치기")).rejects.toThrow(
      /declared file/,
    );
  });

  // ---/+++ 없이 확장 헤더만으로 파일을 옮기는 diff. 모델이 쓴 diff가 여기로 들어오므로
  // (US-B25) 이걸 통과시키면 승인 카드에 "USER.md 수정"이라고 뜬 채 VOICE.md가 사라진다.
  it("refuses a rename smuggled in the extended header", async () => {
    await ensureSelfModelRepo();
    const sneaky = `${PATCH}diff --git a/VOICE.md b/LEAKED.md
similarity index 100%
rename from VOICE.md
rename to LEAKED.md
`;
    await expect(applySelfModelPatch("USER.md", sneaky, "rename 밀반입")).rejects.toThrow(
      /declared file/,
    );
    expect(await readFile(join(dir, "VOICE.md"), "utf8")).toContain("VOICE");
    const { stdout } = await run("git", ["-C", dir, "status", "--porcelain"]);
    expect(stdout.trim()).toBe("");
  });

  // `diff -u`가 붙이는 탭+타임스탬프. 유효한 형식이니 파일명만 떼어 보고 통과시켜야 한다.
  it("accepts a header carrying a trailing tab timestamp", async () => {
    await ensureSelfModelRepo();
    await writeFile(join(dir, "USER.md"), "# Logan\n서울에서 일한다.\n");
    await run("git", ["-C", dir, "commit", "-am", "seed"]);

    const stamped = PATCH.replace("--- a/USER.md", "--- a/USER.md\t2026-09-20 10:00:00").replace(
      "+++ b/USER.md",
      "+++ b/USER.md\t2026-09-20 10:00:01",
    );
    const { commit } = await applySelfModelPatch("USER.md", stamped, "타임스탬프 헤더");
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(join(dir, "USER.md"), "utf8")).toContain("화요일엔 재택한다");
  });

  // 깨끗이 적용되지만 내용이 그대로인 diff → git commit이 "nothing to commit"으로 죽는다.
  // 계약(델타 §3)은 SelfModelPatchError만 던지는 것이다.
  it("throws SelfModelPatchError when the patch changes nothing", async () => {
    await ensureSelfModelRepo();
    await writeFile(join(dir, "USER.md"), "# Logan\n서울에서 일한다.\n");
    await run("git", ["-C", dir, "commit", "-am", "seed"]);

    const noop = PATCH.replace("+서울에서 일하고, 화요일엔 재택한다.", "+서울에서 일한다.");
    await expect(applySelfModelPatch("USER.md", noop, "내용이 같은 패치")).rejects.toThrow(
      SelfModelPatchError,
    );
  });
});
