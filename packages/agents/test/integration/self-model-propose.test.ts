// packages/agents/test/integration/self-model-propose.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_PATCHES,
  MAX_PATCH_LINES,
  SELF_MODEL_CRON,
  SUPPRESSION_WEEKS,
  configureAgents,
  diffHash,
  isSuppressed,
  suppressPatch,
  validatePatch,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
beforeEach(async () => {
  configureAgents({ pool });
  await pool.query("DELETE FROM settings WHERE key LIKE 'self_model.suppressed.%'");
});
afterAll(() => pool.end());

const diff = (lines: number) =>
  [
    "--- a/VOICE.md",
    "+++ b/VOICE.md",
    "@@ -1,1 +1,1 @@",
    ...Array.from({ length: lines }, (_, i) => `+new line ${i}`),
  ].join("\n");

describe("self-model patch constraints (A4 §13.2)", () => {
  it("runs on Sunday 21:00 KST with the documented caps", () => {
    expect(SELF_MODEL_CRON).toBe("0 21 * * 0");
    expect(MAX_PATCHES).toBe(3);
    expect(MAX_PATCH_LINES).toBe(20);
    expect(SUPPRESSION_WEEKS).toBe(4);
  });

  it("needs at least two pieces of evidence, three to delete from USER.md", () => {
    expect(
      validatePatch({ file: "VOICE.md", diff: diff(2), rationale: "r", evidence: ["a"] }).ok,
    ).toBe(false);
    expect(
      validatePatch({ file: "VOICE.md", diff: diff(2), rationale: "r", evidence: ["a", "b"] }).ok,
    ).toBe(true);
    const deletion = ["--- a/USER.md", "+++ b/USER.md", "@@ -1,2 +1,1 @@", "-deleted"].join("\n");
    expect(
      validatePatch({ file: "USER.md", diff: deletion, rationale: "r", evidence: ["a", "b"] }).ok,
    ).toBe(false);
    expect(
      validatePatch({ file: "USER.md", diff: deletion, rationale: "r", evidence: ["a", "b", "c"] })
        .ok,
    ).toBe(true);
  });

  it("rejects a patch longer than 20 changed lines", () => {
    const r = validatePatch({
      file: "VOICE.md",
      diff: diff(21),
      rationale: "r",
      evidence: ["a", "b"],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("20");
  });

  it("suppresses an ignored patch for four weeks by diff hash", async () => {
    const d = diff(2);
    expect(await isSuppressed(pool, diffHash(d))).toBe(false);
    await suppressPatch(pool, diffHash(d));
    expect(await isSuppressed(pool, diffHash(d))).toBe(true);
    expect(diffHash(d)).toBe(diffHash(d));
    expect(diffHash(d)).not.toBe(diffHash(diff(3)));
  });
});
