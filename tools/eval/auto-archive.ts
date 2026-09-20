// A4 §9.5. 시드 JSONL만 읽는다 — 실계정도 모델 호출도 없다(B-D5).
// 여기서 재현하는 것은 T0 경로뿐이다: 하드 게이트(민감·VIP) → ① nonHumanSender → ④ 미답장 → ② 물음표 부재.
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
  console.error(`FAIL: 골든 세트가 150건 미만이다 (${cases.length})`);
  process.exit(1);
}
if (unsafe > 0) {
  console.error("FAIL: VIP·민감 item이 보관되었다");
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
