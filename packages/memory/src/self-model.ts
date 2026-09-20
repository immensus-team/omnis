// 델타 §0-2: 경로는 ~/.omnis/self-model/ (A6 §9의 ~/.omnis 홈 규약). OMNIS_SELF_MODEL_DIR로 덮어쓴다.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { estimateTokens } from "./tokens.js";

export type SelfModelFile = "USER.md" | "VOICE.md" | "PROJECTS.md";

/** 정본 순서. 스냅샷 문자열과 sha256은 요청 순서가 아니라 이 순서로 만든다 — 순서가 흔들리면
 *  같은 내용인데 캐시 프리픽스가 달라져 DeepSeek cache-hit을 통째로 날린다(A4 §1.3). */
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

/** 프로세스 수명 동안 고정. applySelfModelPatch()와 US-B25 승인 경로가 비운다(A4 §13.2). */
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
      continue; // 없는 파일은 조용히 빠진다 — 온보딩 전에는 USER.md만 있는 게 정상이다
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

/** US-B02 산출물의 "경고 시스템 Item" 본문. Item을 쓰는 것은 pool을 쥔 쪽(L5 주간 잡, US-B25)이다 —
 *  @omnis/memory는 @omnis/kernel을 의존하지 않으므로 여기서는 문장만 만든다. */
export function overCapWarning(snap: SelfModelSnapshot): string | null {
  if (snap.overCap.length === 0) return null;
  const lines = snap.overCap.map((f) => `- ${f}: 상한 ${SELF_MODEL_TOKEN_CAPS[f]} 토큰 초과`);
  return `self-model이 상한을 넘었습니다. 다음 항목을 memories로 내리는 걸 제안합니다.\n${lines.join("\n")}`;
}
