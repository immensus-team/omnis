# Gate ⑦: Codex app-server 버전 핀 + 1턴 왕복

- **질문**: `codex app-server`를 `rust-v0.155.1`로 고정 실행하고 JSON-RPC로 1턴을 요청했을 때 프로토콜 에러 없이 `item/started`~`item/completed`까지 완주하는가.
- **소유 부록**: A6(§11.3), 절차 A2 §4.2
- **Owner**: agent (unattended)
- **Host**: macbook
- **실행일**: 2026-09-20
- **결과(Pass/Fail)**: **PASS**
- **측정치/근거**:
  - `codex --version` → `codex-cli 0.155.1` (핀 `rust-v0.155.1`과 일치, `tools/spikes/_probes/2026-09-20-cli-probes.md`와 동일).
  - `codex app-server generate-json-schema --out schema` → **312개** 스키마 파일 생성(최상위 `*.json` 37개 + `v1/`·`v2/` 하위; `git ls-files tools/spikes/gate-07-codex-appserver/schema | wc -l` = 312). 실제 wire 메서드/알림 이름을 스키마 원문에서 확인: 요청 `initialize`, `thread/start`(params: `ThreadStartParams`, 필수 필드 없음), `turn/start`(params: `TurnStartParams`, 필수 `threadId`+`input`); 알림 `thread/started`, `turn/started`, `item/started`, `item/completed`, `turn/completed`.
  - `run.ts`로 실제 1턴 왕복(`npx tsx run.ts`, 로그 원문 `tools/spikes/gate-07-codex-appserver/evidence/run-2026-09-20.txt`): `initialize` → `thread/start`(threadId 획득) → `turn/start`(입력 "reply with exactly the word: pong") 순으로 전송. 수신 시퀀스: `thread/started` → `turn/started` → `item/started`(userMessage) → `item/completed`(userMessage) → `turn/completed`. 두 번 독립 실행 모두 `gate7_pass=true`, 프로세스 exit code `0`.
  - `turn/completed`의 `turn.status`는 `"failed"`, `error.codexErrorInfo="usageLimitExceeded"`(이 Codex 계정의 사용량 한도 초과 — `"try again at Sep 23rd, 2026"`)로, 모델이 실제로 "pong"을 답하지는 못했다. **이것은 프로토콜 에러가 아니라 애플리케이션 레벨 실패다**: JSON-RPC 메시지 자체는 정상 파싱·응답되었고, `turn/completed`가 실패 상태를 실어 나르는 것은 프로토콜이 정의한 정상 동작(A2 §4.2 `turn.completed{status}` 매핑)이다. Pass 기준 원문("프로토콜 에러 없이 1턴 완주")은 모델 응답 내용의 성공이 아니라 프로토콜 왕복의 완주를 요구하므로, 이 결과는 **PASS**로 판정한다.
  - 원문 raw 로그: `tools/spikes/gate-07-codex-appserver/evidence/run-2026-09-20.txt`(커밋에 포함 — `.gitignore`의 `*.log` 때문에 `run.log`가 아니라 `.txt`로 보관한다). 스키마 번들: `tools/spikes/gate-07-codex-appserver/schema/`.
  - 판정의 근거가 되는 수신 3줄(위 로그 원문 발췌, 경로/ID는 실행 당시 값 그대로):

```
<< {"method":"item/started","params":{"item":{"type":"userMessage","id":"01a0bc96-f3c5-7d03-bc0f-fad8c8de73eb","clientId":null,"content":[{"type":"text","text":"reply with exactly the word: pong","text_elements":[]}]},"threadId":"01a0bc96-e864-7cb2-8355-74de581130ec","turnId":"01a0bc96-e916-75b0-bdeb-292e03f1e0b5","startedAtMs":1789870404549},"emittedAtMs":1789870404549}
<< {"method":"item/completed","params":{"item":{"type":"userMessage","id":"01a0bc96-f3c5-7d03-bc0f-fad8c8de73eb","clientId":null,"content":[{"type":"text","text":"reply with exactly the word: pong","text_elements":[]}]},"threadId":"01a0bc96-e864-7cb2-8355-74de581130ec","turnId":"01a0bc96-e916-75b0-bdeb-292e03f1e0b5","completedAtMs":1789870404549},"emittedAtMs":1789870404551}
<< {"method":"turn/completed","params":{"threadId":"01a0bc96-e864-7cb2-8355-74de581130ec","turn":{"id":"01a0bc96-e916-75b0-bdeb-292e03f1e0b5","items":[],"itemsView":"notLoaded","status":"failed","error":{"message":"You’ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 23rd, 2026 6:23 PM.","codexErrorInfo":"usageLimitExceeded","additionalDetails":null,"misalignment":null},"startedAt":1789870401,"completedAt":1789870405,"durationMs":3726}},"emittedAtMs":1789870405550}
```
- **decided_by**: Fable (agent), 2026-09-20 — 위 근거 기반, 프로토콜 왕복 성공 + 실패 사유가 사용량 한도(계정 레벨)이지 프로토콜 결함이 아님을 확인.
- **비고**:
  - Task 계획 원문 `run.ts`의 turn-start 메서드 탐지 로직(`$defs` 키 이름에 `/sendUserTurn|newTurn|userTurn/i` 정규식)은 이 스키마와 맞지 않아 그대로 못 썼다 — 실제 wire 메서드명은 `$defs` 키가 아니라 스키마 안의 메서드-enum 문자열(`"thread/start"`, `"turn/start"`)로 존재한다. `run.ts`를 raw 스키마 텍스트에서 이 리터럴 문자열을 찾는 방식으로 고쳤다(비교: `_probes/2026-09-20-cli-probes.md`가 이미 스키마에서 `thread/start`·`turn/start`·`item/started`·`item/completed`·`turn/completed`를 확인해 둔 것과 일치).
  - `TurnStartParams`는 `threadId`가 필수라 계획 원문처럼 `turn/start`만 단독으로 보낼 수 없다 — `thread/start` 응답에서 `result.thread.id`를 추출해 넘기는 단계를 추가했다(A2 §4.2의 "스레드/턴/아이템 3원 구조"와 일치하는 최소 보정).
  - 실제 계정 사용량 한도가 2026-09-23까지 걸려 있어 모델의 실제 답변 내용은 검증하지 못했다 — 이는 Phase A US-A19 구현 시점에 재확인이 필요하나, 이번 게이트가 판정하는 것(프로토콜 왕복 가부)과는 무관하다.
