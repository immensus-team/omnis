// Delta §0-2: the path is ~/.omnis/self-model/ (A6 §9's ~/.omnis home convention). Overridden by
// OMNIS_SELF_MODEL_DIR.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { estimateTokens } from "./tokens.js";

export type SelfModelFile = "USER.md" | "VOICE.md" | "PROJECTS.md";

/** Canonical order. The snapshot string and sha256 are built in this order, not the request order —
 *  if the order wobbles, the same content yields a different cache prefix and the DeepSeek cache
 *  hit is blown entirely (A4 §1.3). */
export const SELF_MODEL_FILES: readonly SelfModelFile[] = ["USER.md", "VOICE.md", "PROJECTS.md"];

/** A4 §12.3. */
export const SELF_MODEL_TOKEN_CAPS: Record<SelfModelFile, number> = {
  "USER.md": 1200,
  "VOICE.md": 1500,
  "PROJECTS.md": 1500,
};

export interface SelfModelSnapshot {
  files: Partial<Record<SelfModelFile, string>>;
  sha256: string;
  tokenEstimate: number;
  overCap: SelfModelFile[];
}

export function selfModelDir(): string {
  return process.env.OMNIS_SELF_MODEL_DIR ?? join(homedir(), ".omnis", "self-model");
}

/** Fixed for the process lifetime. applySelfModelPatch() and the US-B25 approval path clear it (A4 §13.2). */
let cache = new Map<string, SelfModelSnapshot>();

export function invalidateSnapshotCache(): void {
  cache = new Map();
}

export async function loadSelfModel(files: readonly SelfModelFile[]): Promise<SelfModelSnapshot> {
  const wanted = SELF_MODEL_FILES.filter((f) => files.includes(f));
  const key = wanted.join(",");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const dir = selfModelDir();
  const loaded: Partial<Record<SelfModelFile, string>> = {};
  const overCap: SelfModelFile[] = [];
  let tokenEstimate = 0;
  const hash = createHash("sha256");

  for (const f of wanted) {
    let content: string;
    try {
      content = await readFile(join(dir, f), "utf8");
    } catch {
      continue; // a missing file is silently skipped — before onboarding, having only USER.md is normal
    }
    loaded[f] = content;
    const tokens = estimateTokens(content);
    tokenEstimate += tokens;
    if (tokens > SELF_MODEL_TOKEN_CAPS[f]) overCap.push(f);
    hash.update(`${f}\n${content}\n`);
  }

  const snap: SelfModelSnapshot = {
    files: loaded,
    sha256: hash.digest("hex"),
    tokenEstimate,
    overCap,
  };
  cache.set(key, snap);
  return snap;
}

/** The body of US-B02's "warning system Item". Writing the Item belongs to whoever holds the pool
 *  (the L5 weekly job, US-B25) — @omnis/memory does not depend on @omnis/kernel, so only the
 *  sentence is built here. */
export function overCapWarning(snap: SelfModelSnapshot): string | null {
  if (snap.overCap.length === 0) return null;
  const lines = snap.overCap.map((f) => `- ${f}: over the ${SELF_MODEL_TOKEN_CAPS[f]}-token cap`);
  return `The self-model is over its cap. Consider moving the following entries down into memories.\n${lines.join("\n")}`;
}
