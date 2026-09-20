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
  // Deletes the key for real without tripping biome lint/performance/noDelete (= never leaves the
  // literal string "undefined" behind).
  if (originalDir === undefined) Reflect.deleteProperty(process.env, "OMNIS_SELF_MODEL_DIR");
  else process.env.OMNIS_SELF_MODEL_DIR = originalDir;
  invalidateSnapshotCache();
});

const PATCH = `--- a/USER.md
+++ b/USER.md
@@ -1,2 +1,2 @@
 # Logan
-Works in Seoul.
+Works in Seoul, works from home on Tuesdays.
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
    await writeFile(join(dir, "USER.md"), "# Logan\nText I wrote myself\n");
    await ensureSelfModelRepo();
    expect(await readFile(join(dir, "USER.md"), "utf8")).toContain("Text I wrote myself");
    const { stdout } = await run("git", ["-C", dir, "log", "--oneline"]);
    expect(stdout.trim().split("\n")).toHaveLength(1);
  });
});

describe("applySelfModelPatch", () => {
  it("applies the diff, commits it, and returns the commit sha", async () => {
    await ensureSelfModelRepo();
    await writeFile(join(dir, "USER.md"), "# Logan\nWorks in Seoul.\n");
    await run("git", ["-C", dir, "commit", "-am", "seed"]);

    const { commit } = await applySelfModelPatch("USER.md", PATCH, "reflect Tuesday remote work");
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(join(dir, "USER.md"), "utf8")).toContain("works from home on Tuesdays");

    const { stdout } = await run("git", ["-C", dir, "log", "-1", "--format=%s"]);
    expect(stdout.trim()).toBe("self-model: USER.md — reflect Tuesday remote work");
  });

  // A4 §13.2: applying a patch clears the cache once. Skip that and the next loop keeps using the
  // old prefix.
  it("invalidates the snapshot cache so the next load sees the new text", async () => {
    await ensureSelfModelRepo();
    await writeFile(join(dir, "USER.md"), "# Logan\nWorks in Seoul.\n");
    await run("git", ["-C", dir, "commit", "-am", "seed"]);
    const before = await loadSelfModel(["USER.md"]);

    await applySelfModelPatch("USER.md", PATCH, "reflect Tuesday remote work");
    const after = await loadSelfModel(["USER.md"]);
    expect(after.sha256).not.toBe(before.sha256);
    expect(after.files["USER.md"]).toContain("from home");
  });

  it("throws SelfModelPatchError and leaves the file untouched when the diff does not apply", async () => {
    await ensureSelfModelRepo();
    await writeFile(join(dir, "USER.md"), "# Logan\nA completely different line\n");
    await run("git", ["-C", dir, "commit", "-am", "seed"]);

    await expect(applySelfModelPatch("USER.md", PATCH, "mismatched patch")).rejects.toThrow(
      SelfModelPatchError,
    );
    expect(await readFile(join(dir, "USER.md"), "utf8")).toContain("A completely different line");
  });

  it("refuses a diff that touches a file other than the declared one", async () => {
    await ensureSelfModelRepo();
    const sneaky = PATCH.replace(/USER\.md/g, "VOICE.md");
    await expect(applySelfModelPatch("USER.md", sneaky, "path swap")).rejects.toThrow(
      /declared file/,
    );
  });

  // A diff that moves a file using only the extended header, with no ---/+++. Model-written diffs
  // land here (US-B25), so letting this through shows "edit USER.md" on the approval card while
  // VOICE.md quietly disappears.
  it("refuses a rename smuggled in the extended header", async () => {
    await ensureSelfModelRepo();
    const sneaky = `${PATCH}diff --git a/VOICE.md b/LEAKED.md
similarity index 100%
rename from VOICE.md
rename to LEAKED.md
`;
    await expect(applySelfModelPatch("USER.md", sneaky, "smuggled rename")).rejects.toThrow(
      /declared file/,
    );
    expect(await readFile(join(dir, "VOICE.md"), "utf8")).toContain("VOICE");
    const { stdout } = await run("git", ["-C", dir, "status", "--porcelain"]);
    expect(stdout.trim()).toBe("");
  });

  // The tab + timestamp `diff -u` appends. That is a valid format, so strip the timestamp and look
  // at the filename only — and let it through.
  it("accepts a header carrying a trailing tab timestamp", async () => {
    await ensureSelfModelRepo();
    await writeFile(join(dir, "USER.md"), "# Logan\nWorks in Seoul.\n");
    await run("git", ["-C", dir, "commit", "-am", "seed"]);

    const stamped = PATCH.replace("--- a/USER.md", "--- a/USER.md\t2026-09-20 10:00:00").replace(
      "+++ b/USER.md",
      "+++ b/USER.md\t2026-09-20 10:00:01",
    );
    const { commit } = await applySelfModelPatch("USER.md", stamped, "timestamped header");
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(join(dir, "USER.md"), "utf8")).toContain("works from home on Tuesdays");
  });

  // Applies cleanly but leaves the content identical → git commit dies with "nothing to commit".
  // The contract (delta §3) is to throw SelfModelPatchError and nothing else.
  it("throws SelfModelPatchError when the patch changes nothing", async () => {
    await ensureSelfModelRepo();
    await writeFile(join(dir, "USER.md"), "# Logan\nWorks in Seoul.\n");
    await run("git", ["-C", dir, "commit", "-am", "seed"]);

    const noop = PATCH.replace("+Works in Seoul, works from home on Tuesdays.", "+Works in Seoul.");
    await expect(applySelfModelPatch("USER.md", noop, "no-op patch")).rejects.toThrow(
      SelfModelPatchError,
    );
  });
});
