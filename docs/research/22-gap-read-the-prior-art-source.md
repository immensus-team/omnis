# GAP 3: Reading the source of the three inbox+agent+approval reference implementations

Fetched 2026-09-20 via `gh api`/`gh repo view` against live repos, plus `git clone --depth 1` into scratchpad and direct file reads (not README-level — actual source: `.ts`, `.tsx`, `.rs`, `ARCHITECTURE.md`). Repos: `block/buzz`, `cloudflare/agentic-inbox`, `langchain-ai/agent-inbox`.

## 1. TL;DR

세 레포 소스를 직접 읽은 결과, omnis의 Draft/Action 스키마에 가장 직접적으로 쓸 수 있는 건 **agentic-inbox**다: Draft는 별도 테이블이 아니라 `folder_id='draft'`인 Email row 하나일 뿐이고, LLM tool 목록에서 `send_email`/`send_reply`가 구조적으로 빠져 있다 — "동의 없이 못 보낸다"가 프롬프트 규칙이 아니라 **tool 집합 설계**로 강제된다. **agent-inbox**는 LangGraph `interrupt()`/`Command(resume=...)` 위에 `HumanInterrupt{action_request, config:{allow_accept/edit/respond/ignore}, description}` / `HumanResponse{type, args}` 라는, omnis Action 객체에 거의 그대로 이식 가능한 타입을 갖고 있다. **buzz**의 `request_approval` 워크플로우 액션은 kind 46010~46012까지 정의됐지만 구현이 "resume 안 됨"으로 명시적으로 깨져 있다(🚧 WF-08) — 세 레포 중 실제로 동작하는 approval/resume은 agent-inbox 하나뿐.

## 2. Facts

**agentic-inbox (cloudflare/agentic-inbox)**
- Apache-2.0, ★7,942, created 2026-04-10, **`pushed_at` 2026-04-23** — 마지막 커밋이 5개월 전. 스타 수 대비 유지보수가 사실상 멈춘 스냅샷. VERIFIED — `gh api repos/cloudflare/agentic-inbox`, fetched 2026-09-20.
- 스택: React 19 + React Router v7 (Cloudflare Workers, Hono), Durable Object당 SQLite(Drizzle ORM), R2 첨부, Cloudflare Agents SDK `AIChatAgent`, AI SDK v6(`ai@^6.0.116`), Workers AI 모델 `@cf/moonshotai/kimi-k2.5`. VERIFIED — `package.json`, `workers/agent/index.ts` fetched 2026-09-20.
- **Item 스키마**: `workers/db/schema.ts` — `emails` 테이블 하나(`id, folder_id, subject, sender, recipient, cc, bcc, date, read, starred, body, in_reply_to, email_references, thread_id, message_id, raw_headers`), `folders` 테이블(`id, name, is_deletable`), `attachments` 테이블. **`drafts`라는 별도 테이블이 없다** — draft는 `folder_id = Folders.DRAFT`인 일반 email row다. VERIFIED — 직접 파일 읽음, fetched 2026-09-20.
- **Draft 생성 로직**: `workers/lib/tools.ts` `toolDraftReply`/`toolDraftEmail` — `stub.createEmail(Folders.DRAFT, {...})`로 email row를 만들고 `{status:"draft_saved", draftId, message:"Draft saved to Drafts folder. Review it and confirm to send."}`를 반환. `toolUpdateDraft`는 **update-in-place가 아니라 old draft 삭제 + 새 UUID로 재생성**(재작성 전에 verify 먼저 돌려 데이터 유실 방지 주석 있음). VERIFIED, fetched 2026-09-20.
- **Tool 집합의 구조적 분리**: 인앱 채팅 에이전트(`workers/agent/index.ts` `createEmailTools`)에 노출된 tool은 정확히 9개 — `list_emails, get_email, get_thread, search_emails, draft_email, draft_reply, mark_email_read, move_email, discard_draft`. **`send_email`/`send_reply`는 여기 없다.** 이 두 tool은 `workers/mcp/index.ts`에만 등록되어 있고(외부 MCP 클라이언트, 예: Claude Desktop 전용), 인앱 에이전트의 tool-calling 루프에서는 애초에 호출 불가능. README의 "9 email tools" 문구가 정확히 이 9개와 일치(카운트 검증됨). VERIFIED — 두 파일 모두 직접 읽음, fetched 2026-09-20.
- **승인 UX**: 시스템 프롬프트에 `## CRITICAL: Draft Only - Never Send` 섹션이 있지만, 실제 안전장치는 프롬프트가 아니라 tool 집합 자체(위 항목)다. `app/components/AgentPanel.tsx`의 `DraftActions` 컴포넌트가 `draft_reply`/`draft_email` tool part가 붙은 메시지에 **"Edit & send in composer"** 버튼을 렌더링 → 클릭 시 `ComposePanel`이 draft 내용으로 열리고, 사람이 명시적으로 "Send" 버튼(`handleSend`)을 눌러야 실제 발송 라우트가 호출됨. 이것이 승인 상태 머신 전체: `draft row 생성 → "Edit & send" 버튼 → 사람 편집(optional) → 명시적 Send 클릭 → sent row 생성`. VERIFIED — `AgentPanel.tsx`, `ComposePanel.tsx` 직접 읽음, fetched 2026-09-20.
- **Streaming tool call 렌더링**: `AgentPanel.tsx`의 `TOOL_LABELS` record가 tool 이름 → `{label, icon}` 매핑(예: `draft_reply → "Drafting reply" + PaperPlaneTiltIcon`)을 정의하고, `ToolCallBadge`가 AI SDK `UIMessage` part의 `state`(`output-available`/`result`/`output-error` = 완료, 그 외 = 로딩 스피너)로 진행중/완료를 구분해 뱃지로 렌더링. VERIFIED — 직접 읽음, fetched 2026-09-20.
- **자동 방어**: 신규 메일 도착 시 `handleNewEmail`이 draft 생성 전에 이메일 본문과 스레드 전체를 각각 `isPromptInjection(env.AI, text)`로 스캔하고, injection 탐지 시 draft 생성을 스킵하고 채팅에 경고만 남김. VERIFIED, fetched 2026-09-20.
- **MCP tool 수**: `workers/mcp/index.ts`에 실제로 등록된 tool은 13개 호출 지점(`this.server.tool(`)이 있으나 이름 기준 12개 고유 tool(`list_mailboxes, list_emails, get_email, get_thread, search_emails, draft_reply, create_draft, update_draft, delete_email, send_reply, send_email, mark_email_read, move_email`) — 과제 브리핑의 "9 email tools"는 인앱 에이전트 기준으로만 맞고 MCP 표면 전체 기준으로는 과소 표기. VERIFIED (재계산), fetched 2026-09-20.

**agent-inbox (langchain-ai/agent-inbox)**
- MIT, ★1,092, created 2024-11-04, **pushed 2026-09-18** — 2일 전까지 활발히 유지보수 중(agentic-inbox와 대조적). VERIFIED — `gh api repos/langchain-ai/agent-inbox`, fetched 2026-09-20.
- 스택: Next.js 16.3.4, React 19, `@langchain/langgraph-sdk@^1.9.25`, `@langchain/core@^1.2.10`, Tailwind + shadcn류 컴포넌트. VERIFIED — `package.json`, fetched 2026-09-20.
- **Action/Draft 스키마** (`src/components/agent-inbox/types.ts`, 전체 파일 직접 읽음):
  ```ts
  interface HumanInterruptConfig {
    allow_ignore: boolean; allow_respond: boolean;
    allow_edit: boolean; allow_accept: boolean;
  }
  interface ActionRequest { action: string; args: Record<string, any>; }
  interface HumanInterrupt {
    action_request: ActionRequest;
    config: HumanInterruptConfig;
    description?: string;
  }
  type HumanResponse = {
    type: "accept" | "ignore" | "response" | "edit";
    args: null | string | ActionRequest;
  };
  ```
  Thread 상태는 discriminated union: `status: "idle"|"busy"|"error"` (interrupts 없음) vs `"interrupted"|"human_response_needed"` (interrupts 있음). VERIFIED, fetched 2026-09-20.
- **Resume 메커니즘**: `contexts/ThreadContext.tsx`의 `sendHumanResponse` → `client.runs.stream(threadId, graphId, { command: { resume: response } })` (LangGraph SDK의 표준 `interrupt()`/`Command(resume=...)` 패턴). `hooks/use-interrupted-actions.tsx`가 사람이 고른 응답 배열을 만들어 이 함수에 넘기고, 응답 스트림을 소비하면서 `langgraph_node`별 진행 상태(`currentNode`)를 추적. VERIFIED — 두 파일 직접 읽음, fetched 2026-09-20.
- **Human 응답 UI**: 4가지 액션(accept/edit/respond/ignore) 중 그래프가 `config`로 허용한 것만 버튼으로 노출. `edit` 응답은 "accept 허용 + 편집 안 함"이면 자동으로 `accept`로 다운그레이드되는 로직이 `handleSubmit` 안에 있음(불필요한 diff 방지). `generic-interrupt-value.tsx`는 `action_request.args`(임의 JSON)를 축약/전체 보기 토글로 렌더링하는 범용 컴포넌트 — 문자열/숫자/불리언/배열/객체를 타입별 색상 코딩. VERIFIED, fetched 2026-09-20.
- Email 데모 그래프는 별도 리포(langchain-ai의 다른 repo)에 있고, 이 repo 자체는 "임의의 LangGraph 그래프가 `interrupt()`를 던지면 그 값을 렌더링하는" 범용 뷰어다 — omnis 관점에서는 **Draft/Action UX 뼈대**로만 가치가 있고 email-specific 로직(agentic-inbox 쪽)은 없다. VERIFIED (repo 구조 확인), fetched 2026-09-20.

**buzz (block/buzz)** — 02번 리서치가 README/ARCHITECTURE 레벨까지 이미 검증했으나, 이번 패스에서 워크플로우 스키마와 kind 상수를 직접 파일에서 추출:
- `ARCHITECTURE.md` §"buzz-workflow": 트리거 4종(`message_posted, reaction_added, schedule, webhook`), 액션 7종(`send_message, send_dm, set_channel_topic, add_reaction, call_webhook, request_approval, delay`). YAML 예시(원문 그대로):
  ```yaml
  name: "Incident Triage"
  trigger:
    on: message_posted
    filter: "str_contains(trigger_text, 'P1')"
  steps:
    - id: notify
      action: send_message
      text: "P1 incident detected: {{trigger.text}}"
    - id: page
      if: "str_contains(trigger_text, 'production')"
      action: request_approval
      from: "{{trigger.author}}"
      message: "Page on-call?"
  ```
  VERIFIED — 직접 fetch, 2026-09-20.
- **`request_approval`은 현재 깨져 있음**: "returns `StepResult::Suspended` with a generated UUID token, but the engine does not yet persist the token or resume execution — runs that hit an approval gate are marked as failed (🚧 WF-08)." `execute_from_step()`는 "미래 resume 지원용"으로만 존재. VERIFIED — `ARCHITECTURE.md` 원문, fetched 2026-09-20.
- `crates/buzz-core/src/kind.rs`에서 approval 관련 kind 상수 직접 확인: `KIND_WORKFLOW_APPROVAL_REQUESTED=46010`, `KIND_WORKFLOW_APPROVAL_GRANTED=46011`, `KIND_WORKFLOW_APPROVAL_DENIED=46012`, 그리고 사람이 보내는 응답 이벤트로 보이는 `KIND_APPROVAL_GRANT=46030`, `KIND_APPROVAL_DENY=46031`(별도 범위, workflow 실행 이벤트 46001–46012와 분리됨 — 왜 분리했는지는 코드 주석에 설명 없음, UNVERIFIED 이유). VERIFIED — 파일 직접 읽음, fetched 2026-09-20.
- Draft 관련 kind는 git 도메인에만 존재(`KIND_GIT_STATUS_DRAFT=1633`, NIP-34) — buzz에는 이메일/메시지 레벨의 범용 "Draft" 오브젝트/kind가 없다. omnis의 Draft 요구사항(초안 상태를 가진 아이템)에 buzz는 직접 대응하는 개념이 없음. VERIFIED (kind.rs 전체 grep 결과 draft 관련 매치가 git 도메인뿐), fetched 2026-09-20.

## 3. Options / comparison

| 축 | agentic-inbox | agent-inbox | buzz |
|---|---|---|---|
| 성숙도/유지보수 | ★7,942, **5개월 무커밋** (스냅샷) | ★1,092, 2일 전 커밋(활발) | ★33.7k, daily-ish이나 approval 자체는 미완 |
| Draft 오브젝트 | Item(email)과 동일 테이블, `folder_id`로만 구분 | 없음(범용 뷰어, 도메인 오브젝트는 graph가 정의) | Draft 개념 없음(git 도메인만 예외) |
| Action 승인 스키마 | 없음(코드 레벨 tool 분리로 대체) | **`HumanInterrupt`/`HumanResponse`, 4-way config** | `request_approval` 액션 정의는 있으나 **미작동** |
| 승인 강제 지점 | tool 집합 자체(send 계열이 애초에 agent 손에 없음) | LangGraph `interrupt()`/그래프 설계자가 명시적으로 호출 | 워크플로우 엔진 (broken) |
| Resume/재개 | 불필요(승인 후 재개할 "실행"이 없음 — draft는 이미 완성 상태, 사람이 버튼만 누름) | `Command(resume=response)`, 정식 지원 | 설계는 있으나 미구현 |
| 스트리밍 tool call UI | `TOOL_LABELS` 맵 + state 뱃지, email 도메인 특화 | `tool-call-table.tsx`, `generic-interrupt-value.tsx` — 범용 JSON 렌더러 | 해당 없음(채팅 UI, tool call 개념과 다름) |
| omnis 적합 영역 | **Item/Draft 스키마**, tool 격리 패턴, "Edit & send" 게이트 UX | **Action/Interrupt 스키마**, 4-way response, resume 프로토콜 | 이벤트 kind taxonomy(설계 참고용, 코드는 재사용 안 함) |

## 4. Recommendation for omnis

**Draft는 별도 오브젝트를 만들지 말고 Item의 상태로 모델링하라** (agentic-inbox 패턴, effort S, risk 낮음). `items` 테이블에 `status: 'received' | 'draft' | 'sent' | 'archived'` 같은 필드 하나면 충분하다 — agentic-inbox가 증명한 건 "Draft 전용 테이블/폴리모픽 오브젝트가 없어도 멀티채널 inbox+agent draft가 돌아간다"는 것. omnis가 Slack/Kakao/Gmail/Telegram 등 이미 서로 다른 payload를 가진 채널을 통합해야 하므로, Draft를 또 다른 별도 스키마로 분리하면 "원본 채널 아이템 ↔ draft 아이템"을 다시 연결해야 하는 복잡도만 늘어난다. `in_reply_to`/`thread_id` 필드로 원본과 연결하는 것도 그대로 가져올 만하다.

**Action(=승인이 필요한 실행) 객체는 agent-inbox의 스키마를 그대로 이식하라** (effort S~M, risk 낮음). `HumanInterrupt{action_request:{action,args}, config:{allow_accept,allow_edit,allow_respond,allow_ignore}, description}` / `HumanResponse{type,args}`는 omnis가 필요로 하는 "에이전트가 Codex/Hermes에게 델리게이트하거나 메시지를 보내기 전에 사람 승인을 받는다"는 요구사항과 1:1로 맞는다. `config`의 4-way 플래그(accept/edit/respond/ignore)는 액션 종류별로 다른 승인 UX가 필요하다는 걸 구조로 강제한다 — 예: "Codex에게 델리게이트"는 `allow_accept+allow_edit`만, "KakaoTalk 메시지 발송"은 `allow_accept+allow_edit+allow_ignore`(respond는 의미 없음) 식으로. LangGraph 종속은 필요 없다 — omnis 자체 오케스트레이션 레이어에 이 타입만 그대로 이식하고, "resume"은 LangGraph interrupt 대신 단순 상태 전이(`pending_approval → approved/rejected/edited`)로 구현하면 충분하다(omnis에는 그래프 실행 중단/재개가 필요한 장시간 실행 워크플로우가 아직 없다).

**"승인"을 프롬프트 규칙이 아니라 tool 가용성으로 강제하라** (agentic-inbox의 가장 중요한 교훈, effort S, risk 낮음이지만 지금 안 하면 나중에 비용 큼). agentic-inbox는 시스템 프롬프트에 "절대 보내지 마라"라고 써놓고도, 진짜 안전장치는 **인앱 에이전트의 tool palette에 send 계열을 아예 등록하지 않은 것**이다(반면 MCP 표면에는 별도로 노출 — 외부에서 호출하는 클라이언트가 자기 쪽에서 승인 책임을 진다는 다른 신뢰 경계). omnis도 "메시지 발송/파일 삭제/에이전트 델리게이트" 같은 비가역 tool은 자율 실행 루프의 tool 목록에서 원천 배제하고, 오직 사람이 명시적으로 누르는 UI 액션(승인된 `HumanResponse` 이후)에서만 호출 가능한 별도 code path로 분리해야 한다. 이건 omnis 브리프의 "context-aware reply drafts with notifications"(자동발송 아님, draft+알림)와도 정합적이다.

**buzz의 approval 워크플로우는 참고만 하고 절대 베끼지 마라** (risk: 있음 — 미완성 참조가 됨). `request_approval` 액션이 "resume 안 됨, 마킹만 failed"로 명시적으로 깨져 있다는 걸 이번에 직접 코드에서 확인했다. buzz의 이벤트 kind taxonomy(46010/46011/46012 승인 3단계, 46030/46031 사람 응답)는 "승인 상태를 몇 개의 이산 이벤트로 나눌지"에 대한 설계 아이디어로만 쓰고, 실행 로직은 절대 참조하지 마라 — 미구현 코드를 참고 구현으로 쓰면 존재하지 않는 기능을 있다고 착각하게 된다.

**Effort/risk 요약**: Draft-as-Item-status(S, 리스크 낮음) + Action/HumanInterrupt 스키마 이식(S~M, 리스크 낮음, 단 omnis 자체 상태머신으로 재구현 필요) + tool 격리 원칙 적용(S이지만 설계 초기에 안 하면 나중에 리팩토링 비용 큼) = 이 세 개를 GAP 3의 출력물로 확정하고 §6 Draft/Action 스키마 설계에 바로 반영할 것을 권고.

## 5. What to borrow — concrete pointers

- **Item/Draft = 같은 테이블, status로 구분**: `agentic-inbox/workers/db/schema.ts` (emails 테이블 정의) + `agentic-inbox/workers/lib/tools.ts` `toolDraftReply`/`toolDraftEmail`/`toolUpdateDraft`(라인대: `createEmail(Folders.DRAFT, {...})` 호출부) — omnis `items` 테이블 설계 시 `status` enum과 `in_reply_to`/`thread_id` 연결 패턴을 그대로 참고.
- **Tool 집합의 구조적 분리**: `agentic-inbox/workers/agent/index.ts`의 `createEmailTools()`(9개 tool, send 계열 없음) vs `agentic-inbox/workers/mcp/index.ts`(12개 tool, send 계열 포함) — omnis의 "자율 루프 tool" vs "사람이 명시적으로 트리거하는 action" 두 세트를 코드 레벨로 분리할 때의 참조 구조.
- **"Edit & send" 승인 게이트 UI**: `agentic-inbox/app/components/AgentPanel.tsx`의 `DraftActions`/`hasDraftReplyTool` — 채팅 메시지에 draft tool call이 있을 때만 버튼 노출, 클릭 시 별도 편집 화면으로 이동, 그 화면의 명시적 Send가 진짜 발송을 트리거. omnis Draft 카드의 "Review & Send" 버튼 UX 원형.
- **Action/Interrupt 타입 정의**: `agent-inbox/src/components/agent-inbox/types.ts` 전체(`HumanInterrupt`, `HumanInterruptConfig`, `ActionRequest`, `HumanResponse`, `ThreadData` discriminated union) — omnis Action 객체 TypeScript 인터페이스의 직접 출발점.
- **승인 UI 로직**: `agent-inbox/src/components/agent-inbox/hooks/use-interrupted-actions.tsx`(`handleSubmit`의 accept/edit/respond/ignore 분기, edit→accept 자동 다운그레이드 로직)와 `agent-inbox/src/components/agent-inbox/components/generic-interrupt-value.tsx`(임의 JSON args를 타입별로 색상 코딩해 축약/전체 토글로 보여주는 범용 렌더러) — omnis가 "Codex 델리게이트 args" 같은 구조화된 payload를 사람에게 보여줄 때 그대로 참고.
- **스트리밍 tool call 뱃지**: `agentic-inbox/app/components/AgentPanel.tsx`의 `TOOL_LABELS` record + `ToolCallBadge`(`state` → 로딩/완료 아이콘) — omnis가 agent 세션을 inbox 스레드로 보여줄 때, 각 tool 호출을 사람이 읽을 수 있는 라벨+아이콘+진행 상태로 매핑하는 최소 패턴.
- **이벤트 kind taxonomy (설계 아이디어만)**: `buzz` `ARCHITECTURE.md` §"buzz-workflow"의 트리거 4종/액션 7종 표와 `crates/buzz-core/src/kind.rs`의 승인 kind 3단계(REQUESTED/GRANTED/DENIED) — omnis가 여러 이질적 채널 이벤트를 하나의 `event_type` enum으로 통일할 때, "승인 상태를 몇 단계로 나눌지"의 참고 목록으로만 사용. **코드/구현은 참조 금지**(미완성 확인됨).

## 6. Open questions

- agent-inbox의 실제 email 도메인 그래프(LangGraph 쪽, interrupt를 실제로 던지는 email-assistant 구현)는 별도 repo에 있어 이번 조사 범위 밖 — omnis가 "draft args를 어떻게 구조화하는지"의 실제 예시(예: `action:"send_email", args:{to,subject,body}`)가 필요하면 그 그래프 repo를 추가로 확인해야 한다.
- agentic-inbox가 5개월간 무커밋인 이유(프로젝트 중단인지, 안정판이라 안 건드리는지)는 확인 못함 — Cloudflare가 이 repo를 계속 데모/레퍼런스로 유지할지 여부는 issue 트래커를 봐야 판단 가능.
- buzz의 `KIND_APPROVAL_GRANT/DENY`(46030/46031)가 `KIND_WORKFLOW_APPROVAL_GRANTED/DENIED`(46011/46012)와 별도 kind로 존재하는 이유(사람이 보내는 "의도" 이벤트 vs 시스템이 기록하는 "결과" 이벤트의 분리로 추정)는 코드 주석에 설명이 없어 미확인.
- omnis 자체 Action 상태머신에서 "resume"이 실제로 필요한 시나리오(예: 에이전트가 중간 결과를 스트리밍하다가 승인 대기로 멈추는 경우)가 나오면 LangGraph 같은 정식 checkpoint/resume 인프라 도입이 필요한지, 아니면 단순 상태 전이로 계속 충분한지는 omnis의 실제 델리게이션 워크플로우 설계가 더 진행돼야 판단 가능.

## 7. Sources

- https://github.com/cloudflare/agentic-inbox (repo metadata, README) — fetched 2026-09-20
- https://github.com/cloudflare/agentic-inbox/blob/main/workers/db/schema.ts — fetched 2026-09-20 (cloned, read locally)
- https://github.com/cloudflare/agentic-inbox/blob/main/workers/lib/tools.ts — fetched 2026-09-20
- https://github.com/cloudflare/agentic-inbox/blob/main/workers/agent/index.ts — fetched 2026-09-20
- https://github.com/cloudflare/agentic-inbox/blob/main/workers/mcp/index.ts — fetched 2026-09-20
- https://github.com/cloudflare/agentic-inbox/blob/main/app/components/AgentPanel.tsx — fetched 2026-09-20
- https://github.com/cloudflare/agentic-inbox/blob/main/app/components/ComposePanel.tsx — fetched 2026-09-20
- https://github.com/langchain-ai/agent-inbox (repo metadata, README) — fetched 2026-09-20
- https://github.com/langchain-ai/agent-inbox/blob/main/src/components/agent-inbox/types.ts — fetched 2026-09-20
- https://github.com/langchain-ai/agent-inbox/blob/main/src/components/agent-inbox/hooks/use-interrupted-actions.tsx — fetched 2026-09-20
- https://github.com/langchain-ai/agent-inbox/blob/main/src/components/agent-inbox/contexts/ThreadContext.tsx — fetched 2026-09-20
- https://github.com/langchain-ai/agent-inbox/blob/main/src/components/agent-inbox/components/generic-interrupt-value.tsx — fetched 2026-09-20
- https://github.com/langchain-ai/agent-inbox/blob/main/src/components/agent-inbox/components/interrupt-details-view.tsx — fetched 2026-09-20
- https://github.com/block/buzz/blob/main/ARCHITECTURE.md — fetched 2026-09-20 (re-fetched this pass for full workflow YAML + approval-gate status)
- https://github.com/block/buzz/blob/main/crates/buzz-core/src/kind.rs — fetched 2026-09-20 (re-fetched this pass for approval kind constants)
- /Users/logankim/AI-Workspaces/Claude/omnis/research/02-block-buzz.md — prior research this pass builds on (buzz README/architecture-level facts)
- /Users/logankim/AI-Workspaces/Claude/omnis/research/17-todo-briefing-network-notes.md — prior research, buzz cross-reference
