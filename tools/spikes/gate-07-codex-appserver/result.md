# Gate ⑦: Codex app-server 버전 핀 + 1턴 왕복

- **질문**: `codex app-server`를 `rust-v0.155.1`로 고정 실행하고 JSON-RPC로 1턴을 요청했을 때 프로토콜 에러 없이 `item/started`~`item/completed`까지 완주하는가.
- **소유 부록**: A6(§11.3), 절차 A2 §4.2
- **Owner**: agent (unattended)
- **Host**: macbook
- **실행일**: 2026-09-20
- **결과(Pass/Fail)**: **PASS (프로토콜 왕복 한정 — `agentMessage` 아이템 미관측, 사용량 한도 해제 후 2026-09-23 이후 재실행 필요)**
- **측정치/근거**:
  - `codex --version` → `codex-cli 0.155.1` (핀 `rust-v0.155.1`과 일치, `tools/spikes/_probes/2026-09-20-cli-probes.md`와 동일).
  - `codex app-server generate-json-schema --out schema` → **312개** 스키마 파일 생성(최상위 `*.json` 37개 + `v1/`·`v2/` 하위; `git ls-files tools/spikes/gate-07-codex-appserver/schema | wc -l` = 312). 실제 wire 메서드/알림 이름을 스키마 원문에서 확인: 요청 `initialize`, `thread/start`(params: `ThreadStartParams`, 필수 필드 없음), `turn/start`(params: `TurnStartParams`, 필수 `threadId`+`input`); 알림 `thread/started`, `turn/started`, `item/started`, `item/completed`, `turn/completed`. `TurnStatus` enum = `completed | interrupted | failed | inProgress`(`schema/codex_app_server_protocol.v2.schemas.json`).
  - `npx tsx run.ts`로 실제 1턴 왕복(로그 원문 `evidence/run-2026-09-20b.txt`, 1차 실행분은 `evidence/run-2026-09-20.txt` — 이 로그의 마지막 줄 `gate7_pass=true`는 2값만 찍던 구판 계측기의 출력이고, 같은 로그를 지금 계측기로 재생하면 `degraded`가 나온다: `npx tsx run.ts --replay evidence/run-2026-09-20.txt`): `initialize` → `thread/start`(threadId 획득) → `turn/start`(입력 "reply with exactly the word: pong"). 수신 시퀀스 `thread/started` → `turn/started` → `item/started`(**`item.type="userMessage"` — 우리가 보낸 프롬프트의 에코**) → `item/completed`(동일 userMessage) → `turn/completed`. 최종 줄:

    ```
    gate7_result=degraded protocol_roundtrip=true turn_status=failed turn_error=usageLimitExceeded agent_message_observed=false user_items=[userMessage] agent_items=[] protocol_errors=0
    ```

    exit code `2`(= degraded). 두 실행 모두 동일(`grep -c agentMessage evidence/*.txt` = 0).
  - `turn/completed`의 `turn.status`는 `"failed"`, `error.codexErrorInfo="usageLimitExceeded"`(이 Codex 계정의 사용량 한도 초과 — `"try again at Sep 23rd, 2026 6:23 PM"`). **모델이 실제로 답하지 않았으므로 A2 §4.2 표의 `item/started (agentMessage)` → `turn.item.started{kind:'agent_turn'}` 행은 이번 실행으로 증명되지 않았다** — 관측된 item 이벤트는 서버가 되돌려준 `userMessage` 에코 2건뿐이다.
  - 그럼에도 **판정은 PASS**다: A6 §11.3의 pass 기준 원문은 "프로토콜 에러 없이 1턴 완주"이고, 관측된 실패는 JSON-RPC 레벨이 아니라 애플리케이션 레벨(계정 사용량 한도)이다. JSON-RPC 요청 3건 모두 정상 파싱·응답됐고 JSON-RPC 에러 응답은 0건(`protocol_errors=0`), `turn/completed`가 `status:"failed"`를 실어 나르는 것 자체가 프로토콜이 정의한 정상 동작(A2 §4.2 `turn.completed{status}` 매핑)이다. 여기서 FAIL로 찍으면 A6 §11.3의 Fail 결정 규칙(버전 재핀 + capabilities feature detection 우회)이 잘못 발동한다 — 재핀해도 사용량 한도는 그대로다.
  - **재실행 조건**: 2026-09-23 18:23(한도 해제) 이후 `npx tsx run.ts`를 다시 돌려 `gate7_result=pass`(= `turn_status=completed` **및** `agent_message_observed=true`, exit 0)를 확인한다. 이 시점까지 A2 §4.2의 agentMessage 행은 **미검증**이며, Phase A US-A19(`apps/local-agent/src/bridges/codex.ts`)가 그 매핑을 구현하기 전에 확인돼야 한다.
  - 판정의 근거가 되는 수신 3줄(`evidence/run-2026-09-20b.txt` 발췌, ID는 실행 당시 값 그대로):

```
<< {"method":"item/started","params":{"item":{"type":"userMessage","id":"01a0bca2-7b8b-7253-9f72-c8aae1e802af","clientId":null,"content":[{"type":"text","text":"reply with exactly the word: pong","text_elements":[]}]},"threadId":"01a0bca2-6fc2-7cf0-af30-92cf35266c9e","turnId":"01a0bca2-7095-7060-a6c3-6c642f8092f6","startedAtMs":1789871160203},"emittedAtMs":1789871160203}
<< {"method":"item/completed","params":{"item":{"type":"userMessage","id":"01a0bca2-7b8b-7253-9f72-c8aae1e802af","clientId":null,"content":[{"type":"text","text":"reply with exactly the word: pong","text_elements":[]}]},"threadId":"01a0bca2-6fc2-7cf0-af30-92cf35266c9e","turnId":"01a0bca2-7095-7060-a6c3-6c642f8092f6","completedAtMs":1789871160203},"emittedAtMs":1789871160210}
<< {"method":"turn/completed","params":{"threadId":"01a0bca2-6fc2-7cf0-af30-92cf35266c9e","turn":{"id":"01a0bca2-7095-7060-a6c3-6c642f8092f6","items":[],"itemsView":"notLoaded","status":"failed","error":{"message":"You’ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 23rd, 2026 6:23 PM.","codexErrorInfo":"usageLimitExceeded","additionalDetails":null,"misalignment":null},"startedAt":1789871157,"completedAt":1789871161,"durationMs":3937}},"emittedAtMs":1789871161341}
```
- **decided_by**: Fable (agent), 2026-09-20 — 위 근거 기반. 프로토콜 왕복은 완주(PASS), 모델 응답 경로는 미관측(재실행 조건 명시).
- **비고**:
  - **판정기(run.ts) 설계**: 이벤트 판정은 줄 전체 부분문자열 매칭이 아니라 `params.item.type` 파싱으로 한다. 서버가 프롬프트를 `userMessage` 아이템으로 되돌려주기 때문에, 생짜 매칭은 **우리 자신의 에코만 보고** `item/started`/`item/completed`를 봤다고 보고한다(A2 §4.2가 요구하는 `agentMessage` 행이 증명되지 않는다). 결과 줄은 user 측/에이전트 측 아이템 타입을 따로 찍는다.
  - **판정 3값**: `pass`(exit 0) = 프로토콜 왕복 완주 **및** `turn.status="completed"` **및** agentMessage 아이템 관측 / `degraded`(exit 2) = 프로토콜 왕복은 완주했으나 모델 응답 미관측 / `fail`(exit 1) = 프로토콜 왕복 실패. 계획 원문의 2값(`gate7_pass=true|false`, exit 0|1)에서 이탈했다 — 한도 초과로 아무 일도 안 일어난 턴과 모델이 실제로 답한 턴을 같은 초록 줄로 찍으면 2026-09-23 재실행이 무의미해지기 때문이다.
  - **회귀 검사**: `npx tsx check.ts`(Codex·네트워크 불필요, 3케이스) — ① 실측 로그 재생 시 `degraded`(pass로 찍히면 실패), ② 합성 픽스처(`fixtures/synthetic-agentmessage-pass.ndjson`, agentMessage + `status:"completed"`) 재생 시 `pass`, ③ agentMessage 줄만 제거한 에코-only 재생 시 `degraded`. 기록된 로그 재판정은 `npx tsx run.ts --replay <파일>`로도 직접 돌릴 수 있다. `fixtures/`는 합성 데이터이고 측정 증거가 아니다(실측은 `evidence/`).
  - Task 계획 원문 `run.ts`의 turn-start 메서드 탐지 로직(`$defs` 키 이름에 `/sendUserTurn|newTurn|userTurn/i` 정규식)은 이 스키마와 맞지 않아 그대로 못 썼다 — 실제 wire 메서드명은 `$defs` 키가 아니라 스키마 안의 메서드-enum 문자열(`"thread/start"`, `"turn/start"`)로 존재한다. raw 스키마 텍스트에서 이 리터럴을 찾는 방식으로 고쳤다(`_probes/2026-09-20-cli-probes.md`가 이미 확인해 둔 것과 일치).
  - `TurnStartParams`는 `threadId`가 필수라 계획 원문처럼 `turn/start`만 단독으로 보낼 수 없다 — `thread/start` 응답에서 thread id를 추출해 넘기는 단계를 추가했다(A2 §4.2의 "스레드/턴/아이템 3원 구조"와 일치하는 최소 보정).
  - 원문 raw 로그는 `run.log`가 아니라 `evidence/*.txt`로 보관한다(`.gitignore`의 `*.log`).
