// A4 §10.6: recall@10 ≥ 0.80 + 제외 규칙 위반 0건(하드 게이트).
// 골든 세트가 seed를 들고 있으므로 실계정·실파일 없이 돈다(백로그 B-D5).
//
// `--gate-only`: 제외 규칙 스캔만 돌고 시드를 넣지 않는다. 채점 모드는 DATABASE_URL이 가리키는
// DB에 50건의 가짜 기억을 심으므로 **실 DB에서 돌리면 안 된다** — 허브의 주간 잡은 반드시
// --gate-only로 부른다(apps/hub/src/ingest-job.ts).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPool, query } from "../../packages/db/src/index.js";
import {
  DENY_PATTERNS,
  isDenied,
  searchMemories,
  upsertMemory,
} from "../../packages/memory/src/index.js";

interface EvalCase {
  id: string;
  q: string;
  seed: string;
  source_kind: "inbox" | "calendar" | "file" | "drive" | "github" | "self";
  source_ref: string;
  as_of: string;
}

const GATE_ONLY = process.argv.includes("--gate-only");
const RECALL_TARGET = 0.8;
const K = 10;
const SET_PATH = fileURLToPath(new URL("../../eval/memory_recall.jsonl", import.meta.url));

function loadCases(): EvalCase[] {
  return readFileSync(SET_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as EvalCase);
}

async function main(): Promise<void> {
  const cases = loadCases();
  const pool = createPool();
  let failures = 0;

  try {
    // ── 하드 게이트: 이미 저장된 memories에 제외 패턴이 하나라도 있으면 즉시 실패 ──
    const refs = await query<{ id: string; source_ref: string | null }>(
      pool,
      "SELECT id, source_ref FROM memories WHERE source_ref IS NOT NULL",
    );
    const leaked = refs.filter((r) => r.source_ref !== null && isDenied(r.source_ref));
    if (leaked.length > 0) {
      console.error(`제외 규칙 위반 ${leaked.length}건 (A4 §10.2 하드 게이트):`);
      for (const l of leaked.slice(0, 20)) console.error(`  ${l.id}  ${l.source_ref}`);
      console.error(`패턴 ${DENY_PATTERNS.length}종과 대조했다.`);
      process.exit(1);
    }

    if (GATE_ONLY) {
      console.log(
        `제외 규칙 위반 0건 (패턴 ${DENY_PATTERNS.length}종, source_ref ${refs.length}건 대조).`,
      );
      return;
    }

    // ── 시드: 골든 세트의 기억을 넣는다(멱등 — upsertMemory가 같은 내용을 재사용한다) ──
    for (const c of cases) {
      if (isDenied(c.source_ref)) {
        console.error(`골든 세트 자체가 제외 경로를 참조한다: ${c.id} ${c.source_ref}`);
        process.exit(1);
      }
      await upsertMemory(pool, {
        content: c.seed,
        kind: "fact",
        scope: "unknown",
        source_kind: c.source_kind,
        source_ref: c.source_ref,
        confidence: 0.8,
        valid_from: c.as_of,
      });
    }

    // ── recall@10 ──
    let hits = 0;
    const misses: string[] = [];
    for (const c of cases) {
      const results = await searchMemories(pool, { query: c.q, k: K });
      const found = results.some(
        (r) => r.source_kind === c.source_kind && r.source_ref === c.source_ref,
      );
      if (found) hits += 1;
      else misses.push(`${c.id}  ${c.q}  → 기대 ${c.source_kind}:${c.source_ref}`);
    }

    const recall = hits / cases.length;
    console.log("");
    console.log(`문항        ${cases.length}`);
    console.log(`적중        ${hits}`);
    console.log(`recall@${K}  ${recall.toFixed(3)}  (목표 ${RECALL_TARGET})`);
    if (misses.length > 0) {
      console.log("");
      console.log("놓친 문항:");
      for (const m of misses) console.log(`  ${m}`);
    }
    if (recall < RECALL_TARGET) failures += 1;
  } finally {
    await pool.end();
  }

  process.exit(failures === 0 ? 0 : 1);
}

await main();
