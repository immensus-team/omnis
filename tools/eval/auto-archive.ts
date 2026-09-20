// A4 §9.5. Reads only the seed JSONL — no real accounts and no model calls (B-D5).
// What it reproduces here is the T0 path only: hard gate (sensitive/VIP) → ① nonHumanSender → ④ no reply → ② no question mark.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nonHumanSender } from "../../packages/agents/src/index.js";

interface Case {
  id: string;
  handle: string;
  body: string;
  meta: Record<string, unknown>;
  sensitivity: "normal" | "personal" | "finance" | "legal" | "health";
  vip: boolean;
  i_replied: boolean;
  expect_archive: boolean;
}

const FILE = fileURLToPath(new URL("../../eval/auto_archive.jsonl", import.meta.url));

const cases = readFileSync(FILE, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Case);

let tp = 0;
let fp = 0;
let fn = 0;
let unsafe = 0;

for (const c of cases) {
  const gateBlocked = c.sensitivity !== "normal" || c.vip;
  const archived =
    !gateBlocked &&
    nonHumanSender({ handle: c.handle, meta: c.meta }) &&
    !c.i_replied &&
    !c.body.includes("?") &&
    !c.body.includes("？");
  if (archived && c.expect_archive) tp += 1;
  if (archived && !c.expect_archive) fp += 1;
  if (!archived && c.expect_archive) fn += 1;
  if (archived && (c.sensitivity !== "normal" || c.vip)) unsafe += 1;
}

const precision = tp / Math.max(1, tp + fp);
const recall = tp / Math.max(1, tp + fn);
console.log(
  `auto-archive: n=${cases.length} precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} unsafe=${unsafe}`,
);
if (cases.length < 150) {
  console.error(`FAIL: golden set is under 150 rows (${cases.length})`);
  process.exit(1);
}
if (unsafe > 0) {
  console.error("FAIL: a VIP or sensitive item was archived");
  process.exit(1);
}
if (precision < 0.97) {
  console.error("FAIL: precision < 0.97");
  process.exit(1);
}
if (recall < 0.7) {
  console.error("FAIL: recall < 0.70");
  process.exit(1);
}
