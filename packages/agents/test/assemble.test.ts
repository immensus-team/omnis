import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invalidateSnapshotCache } from "@omnis/memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONTEXT_INPUT_BUDGET_TOKENS,
  buildContext,
  setContextBudget,
} from "../src/context/assemble.js";

let dir: string;
const originalDir = process.env.OMNIS_SELF_MODEL_DIR;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omnis-ctx-"));
  process.env.OMNIS_SELF_MODEL_DIR = dir;
  invalidateSnapshotCache();
  setContextBudget(CONTEXT_INPUT_BUDGET_TOKENS);
});
afterEach(() => {
  if (originalDir === undefined) Reflect.deleteProperty(process.env, "OMNIS_SELF_MODEL_DIR");
  else process.env.OMNIS_SELF_MODEL_DIR = originalDir;
  invalidateSnapshotCache();
});

describe("buildContext — cache boundary (A4 §1.3)", () => {
  it("puts the self-model snapshot in cachedPrefix and nothing time-varying", async () => {
    await writeFile(join(dir, "USER.md"), "# Logan\nWorks in Seoul.\n");
    const ctx = await buildContext({ selfModel: ["USER.md"] });

    expect(ctx.cachedPrefix).toContain("About me (the user)");
    expect(ctx.cachedPrefix).toContain("Works in Seoul");
    // Timestamps, nonces and run_ids live only past the boundary — inside it they would make the
    // cached rate 50x worse.
    expect(ctx.cachedPrefix).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(ctx.cachedPrefix).not.toMatch(/d_[0-9a-f]{16}/);
  });

  it("is byte-identical across two calls with the same self-model", async () => {
    await writeFile(join(dir, "USER.md"), "# Logan\n");
    const a = await buildContext({ selfModel: ["USER.md"] });
    const b = await buildContext({ selfModel: ["USER.md"] });
    expect(b.cachedPrefix).toBe(a.cachedPrefix);
  });

  it("is empty when no slot asked for the self-model", async () => {
    const ctx = await buildContext({});
    expect(ctx.cachedPrefix).toBe("");
    expect(ctx.volatile).toEqual([]);
    expect(ctx.truncated).toBe(false);
  });
});

describe("buildContext — truncation order (A4 §1.3, A4-D15)", () => {
  it("drops PROJECTS.md before touching USER.md", async () => {
    // Frozen: a Hangul filler character, used as a wide (non-ASCII) blob. estimateTokens() charges
    // wide chars 1.5 per token against 4 for ASCII, so an ASCII filler would change the math.
    await writeFile(join(dir, "USER.md"), `# Logan\n${"가".repeat(1000)}`);
    await writeFile(join(dir, "PROJECTS.md"), "프".repeat(9000));
    setContextBudget(1200);

    const ctx = await buildContext({ selfModel: ["USER.md", "PROJECTS.md"] });
    expect(ctx.truncated).toBe(true);
    expect(ctx.cachedPrefix).toContain("# Logan"); // USER.md is never trimmed, whatever happens
    expect(ctx.cachedPrefix).not.toContain("프".repeat(100));
  });

  it("drops the per-recipient VOICE.md samples before dropping PROJECTS.md", async () => {
    await writeFile(join(dir, "USER.md"), "# Logan\n");
    // `## 상대별 샘플` is frozen: it is the Korean heading ("per-recipient samples") that the
    // voice-strip regex in src/context/assemble.ts matches. `샘` is the wide filler as above.
    await writeFile(
      join(dir, "VOICE.md"),
      `# Voice\nBasic rules\n## 상대별 샘플\n${"샘".repeat(5000)}\n`,
    );
    await writeFile(join(dir, "PROJECTS.md"), "one project\n");
    setContextBudget(600);

    const ctx = await buildContext({ selfModel: ["USER.md", "VOICE.md", "PROJECTS.md"] });
    expect(ctx.truncated).toBe(true);
    expect(ctx.cachedPrefix).toContain("Basic rules");
    expect(ctx.cachedPrefix).not.toContain("샘".repeat(50));
    expect(ctx.cachedPrefix).toContain("one project"); // step 4 ran first, step 5 has not yet
  });

  it("never sets truncated when everything fits", async () => {
    await writeFile(join(dir, "USER.md"), "# Logan\n");
    const ctx = await buildContext({ selfModel: ["USER.md"] });
    expect(ctx.truncated).toBe(false);
  });
});

describe("buildContext — provenance", () => {
  it("records an entry per slot even when the slot came back empty", async () => {
    await writeFile(join(dir, "USER.md"), "# Logan\n");
    const ctx = await buildContext({ selfModel: ["USER.md"] });
    expect(ctx.provenance).toEqual([{ slot: "selfModel", itemIds: [], memoryIds: [] }]);
  });
});

describe("buildContext — tokenEstimate", () => {
  it("counts cachedPrefix and every volatile block", async () => {
    await writeFile(join(dir, "USER.md"), "가".repeat(150));
    const ctx = await buildContext({ selfModel: ["USER.md"] });
    expect(ctx.tokenEstimate).toBeGreaterThanOrEqual(100);
  });
});
