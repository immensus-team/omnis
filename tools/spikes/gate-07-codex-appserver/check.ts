// gate-07 verdict regression check — runs without network/Codex.
// `npx tsx check.ts`
//
// Why this is needed: the first implementation used a raw substring match,
// `line.includes("item/started")`, so it reported seeing the A2 §4.2
// `item/started (agentMessage)` row based on nothing but the **echo of our own
// prompt** that the server sends back (`item.type = "userMessage"`), and it also
// marked turns with `turn.status="failed"` (usageLimitExceeded) as pass. This
// check pins down both of those cases.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { newObservations, observeLine, verdict } from "./run.ts";

function replay(path: string) {
  const obs = newObservations();
  for (const line of readFileSync(new URL(path, import.meta.url), "utf8").split("\n")) observeLine(line, obs);
  return verdict(obs);
}

// ① Real measured log (usage limit exceeded): the protocol roundtrip ran to completion, but
//    there is not a single agentMessage item and turn.status="failed" → must be degraded
//    (reporting pass here would make the rerun instrument worthless).
const real = replay("./evidence/run-2026-09-20.txt");
assert.equal(real.protocolRoundtrip, true, "the measured log completed the thread/turn roundtrip");
assert.equal(real.turnStatus, "failed");
assert.deepEqual([...real.userItemsCompleted], ["userMessage"]);
assert.deepEqual([...real.agentItemsStarted], [], "the measured log has no agent-side items");
assert.equal(real.result, "degraded", "a usage-limit-exceeded turn must not be reported as pass");

// ② Synthetic fixture (normal turn): agentMessage item + status=completed → pass.
const synth = replay("./fixtures/synthetic-agentmessage-pass.ndjson");
assert.equal(synth.turnStatus, "completed");
assert.deepEqual([...synth.agentItemsCompleted], ["agentMessage"]);
assert.equal(synth.result, "pass");

// ③ With only the echo and no agentMessage, the turn is not a pass even if it ends as completed.
const echoOnly = newObservations();
for (const line of readFileSync(new URL("./fixtures/synthetic-agentmessage-pass.ndjson", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => !l.includes('"agentMessage"'))) {
  observeLine(line, echoOnly);
}
assert.equal(verdict(echoOnly).result, "degraded", "echo items alone cannot prove the agentMessage row");

console.log("gate7_check=ok (3 cases)");
