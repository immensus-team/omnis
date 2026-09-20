// gate-07 판정기 회귀 검사 — 네트워크/Codex 없이 돈다.
// `npx tsx check.ts`
//
// 왜 필요한가: 1차 구현은 `line.includes("item/started")`라는 생짜 부분문자열 매칭이라
// 서버가 되돌려주는 **우리 자신의 프롬프트 에코**(`item.type = "userMessage"`)만 보고도
// A2 §4.2의 `item/started (agentMessage)` 행을 봤다고 보고했고, `turn.status="failed"`
// (usageLimitExceeded)인 턴도 pass로 찍었다. 이 검사가 그 두 가지를 못박는다.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { newObservations, observeLine, verdict } from "./run.ts";

function replay(path: string) {
  const obs = newObservations();
  for (const line of readFileSync(new URL(path, import.meta.url), "utf8").split("\n")) observeLine(line, obs);
  return verdict(obs);
}

// ① 실측 로그(사용량 한도 초과): 프로토콜 왕복은 완주했지만 agentMessage 아이템이 하나도 없고
//    turn.status="failed" → degraded여야 한다(pass로 찍히면 재실행 계측기가 무용지물).
const real = replay("./evidence/run-2026-09-20.txt");
assert.equal(real.protocolRoundtrip, true, "실측 로그는 thread/turn 왕복을 완주했다");
assert.equal(real.turnStatus, "failed");
assert.deepEqual([...real.userItemsCompleted], ["userMessage"]);
assert.deepEqual([...real.agentItemsStarted], [], "실측 로그에 에이전트 측 아이템은 없다");
assert.equal(real.result, "degraded", "한도 초과 턴을 pass로 보고하면 안 된다");

// ② 합성 픽스처(정상 턴): agentMessage 아이템 + status=completed → pass.
const synth = replay("./fixtures/synthetic-agentmessage-pass.ndjson");
assert.equal(synth.turnStatus, "completed");
assert.deepEqual([...synth.agentItemsCompleted], ["agentMessage"]);
assert.equal(synth.result, "pass");

// ③ 에코만 있고 agentMessage가 없으면, turn이 completed로 끝나도 pass가 아니다.
const echoOnly = newObservations();
for (const line of readFileSync(new URL("./fixtures/synthetic-agentmessage-pass.ndjson", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => !l.includes('"agentMessage"'))) {
  observeLine(line, echoOnly);
}
assert.equal(verdict(echoOnly).result, "degraded", "에코 아이템만으로 agentMessage 행을 증명할 수 없다");

console.log("gate7_check=ok (3 cases)");
