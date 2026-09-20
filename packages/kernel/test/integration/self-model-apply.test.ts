// packages/kernel/test/integration/self-model-apply.test.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool, one } from "@omnis/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAudit } from "../../src/audit.js";
import {
  applyApprovedSelfModelPatch,
  checkPatch,
  selfModelDir,
} from "../../src/self-model/apply.js";

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "omnis-sm-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@example.com"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  writeFileSync(join(dir, "VOICE.md"), "안녕하세요\n", "utf8");
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync("git", ["-C", dir, "commit", "-qm", "init"]);
  return dir;
}

const GOOD = [
  "--- a/VOICE.md",
  "+++ b/VOICE.md",
  "@@ -1 +1,2 @@",
  " 안녕하세요",
  "+대표님, 안녕하세요",
].join("\n");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("self-model apply (A4 §13.2)", () => {
  it("defaults to ~/.omnis/self-model and honours the env override", () => {
    expect(selfModelDir({ HOME: "/h" })).toBe("/h/.omnis/self-model");
    expect(selfModelDir({ HOME: "/h", OMNIS_SELF_MODEL_DIR: "/x" })).toBe("/x");
  });

  it("accepts an applicable diff and rejects a stale one", async () => {
    const dir = repo();
    expect(await checkPatch(dir, GOOD)).toBe(true);
    const stale = ["--- a/VOICE.md", "+++ b/VOICE.md", "@@ -1 +1 @@", "-없는 줄", "+새 줄"].join(
      "\n",
    );
    expect(await checkPatch(dir, stale)).toBe(false);
  });

  // audit_log.target_id는 uuid다(0006_kernel.sql) — 파일 이름을 거기 넣으면 이 insert가 죽는다.
  it("commits the patch and records the audit row the approval executor needs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omnis-sm-home-"));
    writeFileSync(join(dir, "VOICE.md"), "안녕하세요\n", "utf8");
    vi.stubEnv("OMNIS_SELF_MODEL_DIR", dir);
    const approvalId = "77777777-7777-7777-7777-777777777777";
    const pool = createPool();
    try {
      const { commit } = await applyApprovedSelfModelPatch(
        { file: "VOICE.md", diff: GOOD, rationale: "대표님께는 존댓말로 고정한다" },
        { audit: createAudit(pool), approvalId },
      );
      expect(commit).toMatch(/^[0-9a-f]{40}$/);
      expect(readFileSync(join(dir, "VOICE.md"), "utf8")).toContain("대표님, 안녕하세요");

      const row = await one<{
        target_id: string | null;
        after: { file: string; commit: string; rationale: string };
        approval_id: string;
      }>(
        pool,
        `SELECT target_id, after, approval_id FROM audit_log
          WHERE action = 'self_model.applied' ORDER BY seq DESC LIMIT 1`,
      );
      expect(row.target_id).toBeNull();
      expect(row.after.file).toBe("VOICE.md");
      expect(row.after.commit).toBe(commit);
      expect(row.approval_id).toBe(approvalId);
    } finally {
      await pool.end();
    }
  });

  it("refuses a stale diff before @omnis/memory touches the repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omnis-sm-stale-"));
    writeFileSync(join(dir, "VOICE.md"), "안녕하세요\n", "utf8");
    vi.stubEnv("OMNIS_SELF_MODEL_DIR", dir);
    const audit = { record: () => Promise.reject(new Error("audit must not run")) };
    await expect(
      applyApprovedSelfModelPatch(
        {
          file: "VOICE.md",
          diff: ["--- a/VOICE.md", "+++ b/VOICE.md", "@@ -1 +1 @@", "-없는 줄", "+새 줄"].join(
            "\n",
          ),
          rationale: "r",
        },
        { audit, approvalId: "88888888-8888-8888-8888-888888888888" },
      ),
    ).rejects.toThrow(/git apply --check failed/);
    expect(readFileSync(join(dir, "VOICE.md"), "utf8")).toBe("안녕하세요\n");
  });
});
