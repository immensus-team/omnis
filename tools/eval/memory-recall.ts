// A4 §10.6: recall@10 ≥ 0.80 with zero deny-pattern violations (hard gate).
// The golden set carries its own seed, so this runs with no real accounts and no real files (backlog B-D5).
//
// `--gate-only`: runs the deny-pattern scan only and seeds nothing. Scoring mode plants 50 fake
// memories in whatever DB DATABASE_URL points at, so **never run it against a real DB** — the
// hub's weekly job must always call it with --gate-only (apps/hub/src/ingest-job.ts).
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
    // ── hard gate: fail immediately if any stored memory matches a deny pattern ──
    const refs = await query<{ id: string; source_ref: string | null }>(
      pool,
      "SELECT id, source_ref FROM memories WHERE source_ref IS NOT NULL",
    );
    const leaked = refs.filter((r) => r.source_ref !== null && isDenied(r.source_ref));
    if (leaked.length > 0) {
      console.error(`${leaked.length} deny-pattern violation(s) (A4 §10.2 hard gate):`);
      for (const l of leaked.slice(0, 20)) console.error(`  ${l.id}  ${l.source_ref}`);
      console.error(`Checked against ${DENY_PATTERNS.length} pattern(s).`);
      process.exit(1);
    }

    if (GATE_ONLY) {
      console.log(
        `0 deny-pattern violations (${DENY_PATTERNS.length} pattern(s) checked against ${refs.length} source_ref rows).`,
      );
      return;
    }

    // ── seed: load the golden set's memories (idempotent — upsertMemory reuses identical content) ──
    for (const c of cases) {
      if (isDenied(c.source_ref)) {
        console.error(`the golden set itself references a denied path: ${c.id} ${c.source_ref}`);
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
      else misses.push(`${c.id}  ${c.q}  → expected ${c.source_kind}:${c.source_ref}`);
    }

    const recall = hits / cases.length;
    console.log("");
    console.log(`cases       ${cases.length}`);
    console.log(`hits        ${hits}`);
    console.log(`recall@${K}  ${recall.toFixed(3)}  (target ${RECALL_TARGET})`);
    if (misses.length > 0) {
      console.log("");
      console.log("missed cases:");
      for (const m of misses) console.log(`  ${m}`);
    }
    if (recall < RECALL_TARGET) failures += 1;
  } finally {
    await pool.end();
  }

  process.exit(failures === 0 ? 0 : 1);
}

await main();
