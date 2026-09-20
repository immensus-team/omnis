import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SELF_MODEL_FILES,
  SELF_MODEL_TOKEN_CAPS,
  invalidateSnapshotCache,
  loadSelfModel,
  overCapWarning,
  selfModelDir,
} from "../src/self-model.js";

let dir: string;
const originalDir = process.env.OMNIS_SELF_MODEL_DIR;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omnis-self-model-"));
  process.env.OMNIS_SELF_MODEL_DIR = dir;
  invalidateSnapshotCache();
});
afterEach(() => {
  if (originalDir === undefined) Reflect.deleteProperty(process.env, "OMNIS_SELF_MODEL_DIR");
  else process.env.OMNIS_SELF_MODEL_DIR = originalDir;
  invalidateSnapshotCache();
});

describe("selfModelDir", () => {
  it("honours OMNIS_SELF_MODEL_DIR", () => {
    expect(selfModelDir()).toBe(dir);
  });

  // 델타 §0-2: A3 §5의 ~/.omnis/memory/*.md도 A4 §13.2의 ~/omnis/self-model/도 아니다.
  it("defaults to ~/.omnis/self-model", () => {
    Reflect.deleteProperty(process.env, "OMNIS_SELF_MODEL_DIR");
    expect(selfModelDir()).toMatch(/\.omnis[/\\]self-model$/);
  });
});

describe("loadSelfModel", () => {
  it("returns the requested files in canonical order with a stable sha256", async () => {
    await writeFile(join(dir, "USER.md"), "# Logan\n서울에서 일한다.\n");
    await writeFile(join(dir, "VOICE.md"), "# 말투\n짧게 쓴다.\n");

    const first = await loadSelfModel(["VOICE.md", "USER.md"]);
    expect(Object.keys(first.files)).toEqual(["USER.md", "VOICE.md"]); // 요청 순서가 아니라 정본 순서
    expect(first.files["USER.md"]).toContain("서울");
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tokenEstimate).toBeGreaterThan(0);
    expect(first.overCap).toEqual([]);

    invalidateSnapshotCache();
    const second = await loadSelfModel(["USER.md", "VOICE.md"]);
    expect(second.sha256).toBe(first.sha256); // 같은 내용이면 같은 해시 = 캐시 프리픽스 재사용
  });

  it("omits files that do not exist instead of throwing", async () => {
    await writeFile(join(dir, "USER.md"), "# Logan\n");
    const snap = await loadSelfModel(SELF_MODEL_FILES);
    expect(Object.keys(snap.files)).toEqual(["USER.md"]);
  });

  it("reports files over the A4 §12.3 cap in overCap", async () => {
    await writeFile(join(dir, "USER.md"), "가".repeat(SELF_MODEL_TOKEN_CAPS["USER.md"] * 2));
    await writeFile(join(dir, "VOICE.md"), "짧다");
    const snap = await loadSelfModel(["USER.md", "VOICE.md"]);
    expect(snap.overCap).toEqual(["USER.md"]);
  });

  it("caches until invalidateSnapshotCache is called", async () => {
    await writeFile(join(dir, "USER.md"), "v1");
    const a = await loadSelfModel(["USER.md"]);
    await writeFile(join(dir, "USER.md"), "v2 완전히 다른 내용");
    const cached = await loadSelfModel(["USER.md"]);
    expect(cached.sha256).toBe(a.sha256);

    invalidateSnapshotCache();
    const fresh = await loadSelfModel(["USER.md"]);
    expect(fresh.sha256).not.toBe(a.sha256);
  });

  it("caps are exactly the three A4 §12.3 numbers", () => {
    expect(SELF_MODEL_TOKEN_CAPS).toEqual({
      "USER.md": 1200,
      "VOICE.md": 1500,
      "PROJECTS.md": 1500,
    });
  });
});

describe("overCapWarning", () => {
  it("is null when nothing is over the cap", async () => {
    await writeFile(join(dir, "USER.md"), "짧다");
    expect(overCapWarning(await loadSelfModel(["USER.md"]))).toBeNull();
  });

  it("names each over-cap file and its cap", async () => {
    await writeFile(join(dir, "PROJECTS.md"), "가".repeat(4000));
    const body = overCapWarning(await loadSelfModel(["PROJECTS.md"]));
    expect(body).toContain("PROJECTS.md");
    expect(body).toContain("1500");
  });
});
