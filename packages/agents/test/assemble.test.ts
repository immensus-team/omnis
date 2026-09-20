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

describe("buildContext — 캐시 경계 (A4 §1.3)", () => {
  it("puts the self-model snapshot in cachedPrefix and nothing time-varying", async () => {
    await writeFile(join(dir, "USER.md"), "# Logan\n서울에서 일한다.\n");
    const ctx = await buildContext({ selfModel: ["USER.md"] });

    expect(ctx.cachedPrefix).toContain("나(사용자)에 대하여");
    expect(ctx.cachedPrefix).toContain("서울에서 일한다");
    // 타임스탬프·nonce·run_id는 경계 뒤에만 있다 — 여기 들어가면 캐시 단가가 50배가 된다.
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

describe("buildContext — 절삭 순서 (A4 §1.3, A4-D15)", () => {
  it("drops PROJECTS.md before touching USER.md", async () => {
    await writeFile(join(dir, "USER.md"), `# Logan\n${"가".repeat(1000)}`);
    await writeFile(join(dir, "PROJECTS.md"), "프".repeat(9000));
    setContextBudget(1200);

    const ctx = await buildContext({ selfModel: ["USER.md", "PROJECTS.md"] });
    expect(ctx.truncated).toBe(true);
    expect(ctx.cachedPrefix).toContain("# Logan"); // USER.md는 어떤 경우에도 안 깎는다
    expect(ctx.cachedPrefix).not.toContain("프".repeat(100));
  });

  it("drops the per-recipient VOICE.md samples before dropping PROJECTS.md", async () => {
    await writeFile(join(dir, "USER.md"), "# Logan\n");
    await writeFile(
      join(dir, "VOICE.md"),
      `# 말투\n기본 규칙\n## 상대별 샘플\n${"샘".repeat(5000)}\n`,
    );
    await writeFile(join(dir, "PROJECTS.md"), "프로젝트 하나\n");
    setContextBudget(600);

    const ctx = await buildContext({ selfModel: ["USER.md", "VOICE.md", "PROJECTS.md"] });
    expect(ctx.truncated).toBe(true);
    expect(ctx.cachedPrefix).toContain("기본 규칙");
    expect(ctx.cachedPrefix).not.toContain("샘".repeat(50));
    expect(ctx.cachedPrefix).toContain("프로젝트 하나"); // 4단계가 먼저, 5단계는 아직
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
