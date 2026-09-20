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

  // delta §0-2: neither A3 §5's ~/.omnis/memory/*.md nor A4 §13.2's ~/omnis/self-model/.
  it("defaults to ~/.omnis/self-model", () => {
    Reflect.deleteProperty(process.env, "OMNIS_SELF_MODEL_DIR");
    expect(selfModelDir()).toMatch(/\.omnis[/\\]self-model$/);
  });
});

describe("loadSelfModel", () => {
  it("returns the requested files in canonical order with a stable sha256", async () => {
    await writeFile(join(dir, "USER.md"), "# Logan\nWorks in Seoul.\n");
    await writeFile(join(dir, "VOICE.md"), "# Voice\nKeeps it short.\n");

    const first = await loadSelfModel(["VOICE.md", "USER.md"]);
    expect(Object.keys(first.files)).toEqual(["USER.md", "VOICE.md"]); // canonical order, not request order
    expect(first.files["USER.md"]).toContain("Seoul");
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tokenEstimate).toBeGreaterThan(0);
    expect(first.overCap).toEqual([]);

    invalidateSnapshotCache();
    const second = await loadSelfModel(["USER.md", "VOICE.md"]);
    expect(second.sha256).toBe(first.sha256); // same content = same hash = cache prefix reuse
  });

  it("omits files that do not exist instead of throwing", async () => {
    await writeFile(join(dir, "USER.md"), "# Logan\n");
    const snap = await loadSelfModel(SELF_MODEL_FILES);
    expect(Object.keys(snap.files)).toEqual(["USER.md"]);
  });

  it("reports files over the A4 §12.3 cap in overCap", async () => {
    // Frozen hangul fixture: "가" counts at 1.5 chars/token, so this is what actually busts the cap.
    await writeFile(join(dir, "USER.md"), "가".repeat(SELF_MODEL_TOKEN_CAPS["USER.md"] * 2));
    await writeFile(join(dir, "VOICE.md"), "short");
    const snap = await loadSelfModel(["USER.md", "VOICE.md"]);
    expect(snap.overCap).toEqual(["USER.md"]);
  });

  it("caches until invalidateSnapshotCache is called", async () => {
    await writeFile(join(dir, "USER.md"), "v1");
    const a = await loadSelfModel(["USER.md"]);
    await writeFile(join(dir, "USER.md"), "v2 completely different content");
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
    await writeFile(join(dir, "USER.md"), "short");
    expect(overCapWarning(await loadSelfModel(["USER.md"]))).toBeNull();
  });

  it("names each over-cap file and its cap", async () => {
    // Frozen hangul fixture: only non-ASCII text reaches 1,500 tokens in 4,000 characters.
    await writeFile(join(dir, "PROJECTS.md"), "가".repeat(4000));
    const body = overCapWarning(await loadSelfModel(["PROJECTS.md"]));
    expect(body).toContain("PROJECTS.md");
    expect(body).toContain("1500");
  });
});
