# github.com/block/buzz teardown

Fetched 2026-09-20 via `gh` CLI (repo API + raw file contents). All facts below sourced live from the repo; no training-data recall used.

## 1. TL;DR

Buzz는 Block(옛 Square)이 만든 **자체 호스팅 팀 커뮤니케이션 플랫폼**으로, 모든 이벤트(메시지, 리액션, git 커밋, workflow 실행, 리뷰 승인 등)를 Nostr 프로토콜(NIP-01) 위의 서명된 이벤트로 저장한다. 핵심 철학은 "human과 agent가 같은 identity model, 같은 audit log를 공유"하는 것 — agent는 자기 keypair를 갖고 채널 멤버가 된다. Rust 모놀리포(relay + Postgres + Redis + S3/MinIO), Tauri+React 데스크톱 앱, agent-first CLI(`buzz-cli`, JSON in/out), ACP(Agent Client Protocol) 하네스로 goose/Codex/Claude Code를 연결한다. Block의 자체 agent framework인 goose와는 다른 프로젝트이며, goose를 "지원하는 agent 중 하나"로만 취급한다. Apache 2.0, ★33.7k, 6개월 된 매우 활발한 프로젝트. omnis에는 직접 이식보다는 **아키텍처 아이디어**(단일 이벤트 로그, agent를 channel member로 취급, YAML workflow, ACP 하네스 패턴)로서 가치가 크다.

## 2. Facts

- **정체**: "A workspace where humans and agents build together, on a relay you own" — self-hosted Nostr-relay 기반 팀 워크스페이스. VERIFIED. Source: https://github.com/block/buzz README (fetched 2026-09-20 via `gh api repos/block/buzz/readme`).
- **저장소 메타**: 생성일 2026-03-06, 최근 push 2026-09-19(사실상 매일 커밋), 언어 Rust(21.9M bytes) > TypeScript(15.2M) > Dart(5.9M, 모바일) > JavaScript(4.8M) > Swift(674K) > Python/Shell/PLpgSQL/CSS/Kotlin 등. VERIFIED. Source: `gh api repos/block/buzz` + `gh api repos/block/buzz/languages`, fetched 2026-09-20.
- **인기도/성숙도**: ★33,695, fork 4,425, open issues 3,622, 30명+ contributor(첫 페이지 기준, 상위 wesbillman 686 commits, wpfleger96 507, tlongwell-block 407 — 모두 Block 소속으로 보이는 handle). VERIFIED (수치), 기여자 소속은 handle 추정 UNVERIFIED. Source: `gh api repos/block/buzz/contributors`, fetched 2026-09-20.
- **라이선스**: Apache License 2.0. VERIFIED. Source: repo `LICENSE` file / GitHub API `licenseInfo`, fetched 2026-09-20.
- **릴리스 페이스**: 최신 `desktop-v0.5.23` (2026-09-05), 이전 버전들이 8월 하순부터 며칠 간격으로 나옴 — 활발한 daily-ish 배포 cadence. VERIFIED. Source: `gh api repos/block/buzz/releases`, fetched 2026-09-20.
- **goose와의 관계**: Buzz ≠ goose. Buzz는 별도 프로젝트이며 `buzz-acp`(ACP 하네스)를 통해 **goose, Codex(codex-acp 경유), Claude Code(claude-agent-acp 경유)** 세 가지 agent 런타임을 pluggable하게 지원한다. goose는 그중 하나의 백엔드일 뿐(예: `GOOSE_MODE=auto` env var로 구동). VERIFIED. Source: `crates/buzz-acp/README.md`, fetched 2026-09-20.
- **프로토콜/데이터 모델**: 모든 액션이 Nostr NIP-01 이벤트(`id, pubkey, kind, tags, content, sig`, Schnorr 서명). `kind` 정수가 유일한 dispatch 축 — 새 기능 = 새 kind 번호. Kind 범위: 0–9999 표준 Nostr, 10000–19999 replaceable(NIP-16), 20000–29999 ephemeral(저장 안 함, audit 제외), 30000–39999 parameterized replaceable, 40000–49999 Buzz custom. `buzz-core::kind.rs`에 127개 kind 상수 정의(집필 시점). VERIFIED. Source: `ARCHITECTURE.md`, fetched 2026-09-20.
- **아키텍처**: 단일 relay(`buzz-relay`, Axum, WebSocket+REST)가 "single source of truth". 뒷단은 Postgres(이벤트/채널/토큰/workflow/audit + FTS 전문검색), Redis(presence, typing, pub/sub fan-out), S3/MinIO(Blossom 미디어). Multi-community(멀티테넌트) 모드는 host header로 community를 resolve해서 모든 하위 시스템(search, workflow, media, git, audit)에 스코프를 전파. VERIFIED. Source: `ARCHITECTURE.md` + README architecture diagram, fetched 2026-09-20.
- **git 통합**: NIP-34(패치, repo announcement, status)를 이벤트로 저장하는 자체 git hosting backend + `git-sign-nostr`/`git-credential-nostr` crate로 git 커밋에 Nostr 서명을 붙임. "브랜치 = 채널"이라는 컨셉(feature branch를 열면 채널이 자동 생성되고 패치/CI/리뷰/머지 결정이 그 방에 함께 남음). VERIFIED (기능 존재), "동작이 완전히 매끄럽다"는 품질 주장은 README 자체가 "Being wired up" 표로 일부 기능(workflow approval gates, huddle lifecycle)을 미완으로 명시. Source: README, fetched 2026-09-20.
- **Workflow 자동화**: `buzz-workflow` crate — YAML-as-code 자동화 엔진, message/reaction/schedule/webhook 트리거 지원(README 기재), kind 46001–46012가 workflow 실행 이벤트. VERIFIED (존재/트리거 종류), 세부 YAML 스키마는 이번 조사에서 파일 레벨까지 열람 못함 → UNVERIFIED 세부. Source: 최상위 README "Works today" 표 + `ARCHITECTURE.md` kind table, fetched 2026-09-20.
- **에이전트 표면(agent surface)**: `buzz-cli`(agent-first, JSON in/out, exit code 규약 0/1/2/3/4/5), `buzz-acp`(ACP↔MCP 브릿지, relay의 @mention을 감지해 agent를 프롬프트), `buzz-agent`(ACP agent 자체 구현), `buzz-dev-mcp`(shell + file-edit MCP 툴), `buzz-persona`(agent persona 팩). 에이전트는 자기 Nostr keypair(`BUZZ_PRIVATE_KEY`)로 채널 멤버가 되고 `kind:13534` membership 이벤트로 등록됨 — 권한은 "동일 identity 모델" 안에서 스코프됨(별도 permission-flag 시스템 아님). VERIFIED. Source: `crates/buzz-acp/README.md`, `crates/buzz-cli/README.md`, `ARCHITECTURE.md`, fetched 2026-09-20.
- **UI 스택**: 데스크톱 앱 = Tauri + React(TypeScript). 모바일(iOS+Android)은 Flutter/Dart로 "wired up" 중(미완성, 저장소에 `mobile/` 디렉터리와 Dart 5.9M bytes 존재). VERIFIED. Source: README "Works today/Being wired up" 표 + `gh api .../languages`, fetched 2026-09-20.
- **미완성 영역(README가 직접 명시)**: mobile 클라이언트, workflow approval gates, huddle lifecycle 이벤트는 "🚧 Being wired up". Web-of-trust 평판, push notification, "culture features"는 "💭 Strong opinions, pending code" — 즉 계획만 있고 코드 없음. VERIFIED. Source: README, fetched 2026-09-20.
- **Block 내부 배포**: Block 직원은 OSS 릴리스 대신 `squareup/buzz-releases`의 내부 빌드를 쓰라고 README가 명시 — 즉 이 OSS repo는 Block 내부에서 실제로 daily-driver로 쓰이는 프로덕트의 공개 버전. VERIFIED. Source: README "I work at Block" 섹션, fetched 2026-09-20.
- **호스팅 옵션**: Railway 원클릭 배포 버튼 제공, 프로덕션은 `deploy/compose/`의 Docker Compose 번들(Postgres+Redis+MinIO+선택적 Caddy/TLS). VERIFIED. Source: README, fetched 2026-09-20.

## 3. Options / comparison table

| 항목 | Buzz | omnis 현재 방향 |
|---|---|---|
| 데이터 모델 | 모든 것이 Nostr 서명 이벤트(NIP-01), kind로 dispatch | 채널별 원본 스키마 + 통합 inbox 뷰(Slack/Kakao/Gmail 등 이질적 소스) |
| 채널 소스 | 자체 relay 안(채팅/git/workflow)만 — Slack/Gmail 등 외부 채널 통합은 없음 | Slack/Kakao/Gmail/Outlook/Telegram/LinkedIn/WhatsApp + agent 세션까지 통합 |
| Agent 통합 방식 | 자기 keypair를 가진 channel member, ACP 하네스로 goose/Codex/Claude Code 연결 | Claude Code/Codex CLI/DeepSeek/Hermes 세션을 inbox thread로 취급 |
| Agent 간 통신 | 같은 relay/채널 안에서 @mention, 같은 audit log 공유 | "agent가 서로의 세션을 이해하고 cross-session action" (설계 목표, 미구현) |
| 자동화 | YAML workflow(message/reaction/schedule/webhook 트리거) | nightly digest, todo delegation, auto-label (설계 목표) |
| UI | Tauri+React 데스크톱, Flutter 모바일(미완) | Mac 클라이언트 + iPhone, kinso.ai 레퍼런스 |
| 배포 토폴로지 | 단일 relay = single source of truth, multi-tenant는 host-based community 분리 | Mac mini가 hub, MacBook/iPhone은 client, 최종적으로 hub-less |
| 라이선스/리스크 | Apache 2.0, OSS, Block 후원 | N/A |
| 성숙도 | ★33.7k, daily release, 3.6k open issues(백로그 큼), 6개월차 | 신규 프로젝트 |

Buzz는 **omnis와 문제 영역이 다르다**: Buzz는 "새 팀 채팅 플랫폼을 처음부터 만든다"(Slack 대체), omnis는 "기존 채널들을 통합하는 개인용 inbox"다. 겹치는 부분은 "agent를 channel member/inbox actor로 다룬다"는 철학과 "단일 이벤트 로그 + audit trail" 설계, 그리고 ACP 하네스 패턴(여러 CLI agent를 하나의 프로토콜로 붙이는 방법)이다.

## 4. Recommendation for omnis

**Buzz 자체를 포크/구동하지 마라.** omnis는 "여러 외부 채널을 통합하는 1인용 inbox"이고 Buzz는 "자체 relay를 중심으로 한 새 팀 채팅 앱"이라 문제가 다르다. Buzz를 도입하면 Slack/Kakao/Gmail 같은 기존 채널을 없애고 모두를 Buzz relay로 이주시켜야 하는데, 이는 omnis 브리프의 전제(기존 채널을 유지한 채 통합)와 정면으로 충돌한다. Effort: 만약 억지로 Buzz를 기반으로 한다면 L(대형) — Rust 모놀리포 학습, self-host 운영, 그리고 결국 Slack/Kakao 등 외부 채널을 Buzz 안으로 어떻게든 브릿지해야 하는 추가 작업까지 필요. Risk: 낮음(Apache 2.0, ToS 문제 없음)이지만 유지보수 리스크가 큼 — 6개월 된 급성장 프로젝트라 API가 빠르게 바뀌고(daily release), open issue 3,622개는 아직 거친 모서리가 많다는 신호.

**대신 "아이디어만 훔쳐라" (effort: 없음, 이미 읽음).** 세 가지가 omnis 설계에 직접 도움된다:
1. **Agent를 channel/thread의 1급 참여자로 모델링**하는 identity 설계 — omnis의 "agent 세션도 inbox thread"라는 목표와 정확히 같은 철학. Buzz의 "agent = 자기 keypair를 가진 member"는 omnis에서 "agent 세션 = 자기 대화 스레드를 가진 발신자"로 그대로 대응시킬 수 있다.
2. **ACP 하네스 패턴**(`buzz-acp`: 이벤트 소스를 구독 → 관련 이벤트를 agent에게 프롬프트로 전달 → agent가 CLI를 통해 응답을 다시 이벤트로 씀)은 omnis가 Claude Code/Codex/DeepSeek/Hermes 세션을 inbox에 연결할 때 쓸 수 있는 정확히 같은 패턴(polling/webhook → normalize → agent prompt → write-back)이다.
3. **YAML workflow 트리거 모델**(message/reaction/schedule/webhook)은 omnis의 nightly digest, auto-label, follow-up automation을 설계할 때 참고할 트리거 taxonomy로 쓸 만하다.

omnis가 굳이 이벤트 소싱을 도입한다면 Nostr 전체를 끌어올 필요 없이, "모든 inbox 항목 = append-only signed(선택)-or-plain 이벤트, type으로 dispatch"라는 **개념만** 빌려 자체 Postgres 스키마로 훨씬 가볍게 구현하는 편이 낫다 — Buzz의 Nostr/Schnorr 서명 체계는 멀티파티 신뢰가 필요 없는 1인용 앱엔 과잉이다.

## 5. What to borrow (구체적 포인터)

- **Agent-as-member 모델**: `crates/buzz-acp/README.md` "Generating Keys" 섹션 — agent마다 별도 keypair, `add-member`로 등록. omnis에서는 "agent 세션마다 별도 sender identity + inbox 상 노출 방식"을 설계할 때 참고.
- **ACP 하네스 다이어그램**: `crates/buzz-acp/README.md` 상단 `Buzz Relay ──WS──→ buzz-acp ──stdio──→ Your Agent` 다이어그램 — omnis의 "channel event → normalize → agent runtime → write back" 파이프라인 설계에 그대로 대응.
- **Kind 기반 dispatch**: `ARCHITECTURE.md` §2 "The Protocol" / Kind Ranges 표, `crates/buzz-core/src/kind.rs`(127개 kind 상수) — "새 채널 타입 = 새 정수 상수 하나 추가"라는 확장 패턴은 omnis가 Slack/Kakao/Gmail/agent-session 등 이질적 소스를 하나의 `event_type` enum으로 통일할 때 참고할 만한 최소 설계.
- **JSON in/out CLI 규약**: `crates/buzz-cli/README.md` — stdout=JSON, stderr=JSON 에러, exit code 0/1/2/3/4/5(ok/user-error/network/auth/other/write-conflict) 규약은 omnis가 agent-facing CLI(예: `claude-ds` 델리게이션, Hermes API 호출 래퍼)를 만들 때 그대로 채용할 수 있는 작고 실용적인 컨벤션.
- **Workflow 트리거 종류**: 최상위 README "Works today" 표 한 줄 — "YAML workflows: message / reaction / schedule / webhook triggers" — omnis의 nightly digest(=schedule trigger)와 auto-label(=message trigger) 설계의 최소 참조점.
- **Multi-tenant 격리 패턴** (omnis엔 당장 불필요하지만 향후 다중 사용자 확장 시): `ARCHITECTURE.md` "A Buzz community is the tenant-visible workspace selected by the request host" — host 기반 community resolve를 모든 하위 시스템 진입점에 강제하는 방식.
- **피할 것**: Nostr/Schnorr 서명 인프라 전체(`buzz-core`, `buzz-auth`), git NIP-34 이벤트화, Blossom 미디어 저장소 — omnis 스코프에 비해 과설계이며 이식 비용 대비 효용이 낮음.

## 6. Open questions

- Buzz의 YAML workflow 스키마 상세(파일 경로/예시)를 이번 조사에서 실제로 열람하지 못했다 — `crates/buzz-workflow/README.md`를 `gh api`로 재시도(base64 디코딩 실패, 파일이 비어있거나 다른 인코딩일 가능성) 필요.
- Buzz의 기여자 상위 3명(wesbillman, wpfleger96, tlongwell-block)이 실제 Block 정직원인지, 어느 팀(구 Square, Cash App, 별도 Buzz 팀) 소속인지는 handle만으로 추정했고 미확인.
- 3,622개 open issue 중 얼마나 stale/duplicate인지, "실사용 가능한 성숙도"를 별도로 라벨/마일스톤 데이터로 확인하지 않음.
- Railway 원클릭 배포나 self-host Compose 번들의 실제 운영 비용(리소스 요구량)은 확인하지 않음 — omnis가 참고할 인프라 규모 감을 잡으려면 `deploy/compose/README.md`를 추가로 읽어야 함.

## 7. Sources

- https://github.com/block/buzz (repo home, metadata) — fetched 2026-09-20
- https://github.com/block/buzz (README, via `gh api repos/block/buzz/readme`) — fetched 2026-09-20
- https://github.com/block/buzz/blob/main/ARCHITECTURE.md (via `gh api repos/block/buzz/contents/ARCHITECTURE.md`) — fetched 2026-09-20
- https://github.com/block/buzz/blob/main/crates/buzz-acp/README.md — fetched 2026-09-20
- https://github.com/block/buzz/blob/main/crates/buzz-cli/README.md — fetched 2026-09-20
- https://github.com/block/buzz/releases (via `gh api repos/block/buzz/releases`) — fetched 2026-09-20
- https://github.com/block/buzz/graphs/contributors (via `gh api repos/block/buzz/contributors`) — fetched 2026-09-20
- GitHub REST API `repos/block/buzz/languages`, `/git/trees/main`, `/contents/crates` — fetched 2026-09-20

## Verification (adversarial)

Independent re-fetch of primary sources on 2026-09-20 (fresh `gh api`/`gh repo view` calls against `block/buzz`, decoded README.md, ARCHITECTURE.md, `crates/buzz-acp/README.md`, `crates/buzz-cli/README.md`, `crates/buzz-core/src/kind.rs`; one `gh api repos/block/goose` check). No web search budget remained in this session (exhausted by a prior process), so all verification below is GitHub-primary-source only — no blog/secondary corroboration was attempted.

| Claim | Verdict | Evidence URL | Correction |
|---|---|---|---|
| Buzz = self-hosted platform, every action is a signed Nostr NIP-01 event, `kind` integer is the sole dispatch axis | **Confirmed** | https://github.com/block/buzz#readme ("It's a Nostr relay: every message, reaction, workflow step, review approval, and git event is a signed event in one log"); https://github.com/block/buzz/blob/main/ARCHITECTURE.md ("The `kind` integer is the only dispatch switch. ... New feature = new kind number = zero breaking changes.") — fetched 2026-09-20 | None. Exact wording verified in both README and ARCHITECTURE.md. |
| Buzz is a separate project from goose; integrates goose + Codex + Claude Code as pluggable ACP backends via `buzz-acp` | **Confirmed**, with one correction | https://github.com/block/buzz/blob/main/crates/buzz-acp/README.md ("Supports any agent that speaks ACP over stdio: goose, codex (via codex-acp), and claude code (via claude-agent-acp)") — fetched 2026-09-20 | The claim's framing of goose as "**Block's** goose agent framework" is now stale. `gh api repos/block/goose` redirects to `aaif-goose/goose` (same repo id `846698999`, i.e. a GitHub org transfer, not a fork) — goose is no longer hosted under the `block` GitHub org as of 2026-09-20. Buzz's own docs never claim goose is Block-owned; they just name it as one of three supported agent runtimes, so the *integration* claim is unaffected, but "Block's goose" should not be repeated as current fact without re-checking goose's org/governance. |
| Repo stats: Apache 2.0, 33,695 stars, 4,425 forks, 3,622 open issues, created 2026-03-06, latest release `desktop-v0.5.23` on 2026-09-05, daily-ish release cadence | **Confirmed**, cadence claim needs a caveat | `gh api repos/block/buzz` → stargazers_count 33695, forks_count 4425, open_issues_count 3622, created_at 2026-03-06T21:00:56Z, license apache-2.0; `gh api repos/block/buzz/releases` → latest tag `desktop-v0.5.23` published 2026-09-05T18:40:15Z — fetched 2026-09-20 | All counts match exactly (re-fetched independently, same numbers). Release history (Aug 10 → Sep 5) shows real releases every 1–5 days, supporting "daily-ish" for that window — **but** as of this fetch (2026-09-20), 15 days have passed since the last release (2026-09-05) with none since, meaning the "daily-ish" cadence had visibly stalled in the 2 weeks before this research was written. That gap is not mentioned in the original file. |
| Architecture: single `buzz-relay` (Rust/Axum, WS+REST) is sole source of truth; backed by Postgres (events+FTS), Redis (presence/pub-sub), S3/MinIO (media); agents get a keypair + channel membership (`kind:13534`) | **Confirmed** | https://github.com/block/buzz/blob/main/ARCHITECTURE.md ("The relay is the single source of truth... Postgres, Redis... Blossom/S3 media storage"); `crates/buzz-cli/README.md` `add-member` command description: "publishes kind:13534 roster" — fetched 2026-09-20 | None. |
| UI stack: Tauri+React desktop shipped; Flutter mobile (iOS+Android) unfinished ("Being wired up") | **Confirmed** | README "Works today · Being wired up" table: "Desktop app (Tauri + React)" under ✅, "Mobile clients (iOS + Android, Flutter)" under 🚧; `gh api repos/block/buzz/languages` shows Dart at 5,936,647 bytes (present but far below Rust 21.9M / TypeScript 15.2M) — fetched 2026-09-20 | None. |
| `buzz-cli` is agent-first JSON in/out with exit-code convention 0/1/2/3/4/5 (ok/user error/network/auth/other/write conflict) covering messages, channels, reactions, DMs, workflows | **Confirmed** | https://github.com/block/buzz/blob/main/crates/buzz-cli/README.md line 25: "Exit codes: 0=ok, 1=user error, 2=network, 3=auth, 4=other, 5=write conflict" — full command table also confirms `messages`, `channels`, `reactions`, `dms`, `workflows` groups plus several not mentioned in the original file (`canvas`, `gifs`, `users`, `feed`, `social`, `repos`, `upload`, `pack`, `mem`) — fetched 2026-09-20 | None on the core claim; the command surface is broader than the five groups cited (minor incompleteness, not an error). |
| `buzz-workflow` YAML automation, triggers = message/reaction/schedule/webhook, kinds 46001–46012; exact YAML schema "not directly verified... README fetch failed to decode" (medium confidence) | **Refuted** (on the "unverifiable" part) — kind range and trigger list confirmed, but the schema-not-verified claim is wrong | `gh api repos/block/buzz/contents/crates/buzz-workflow/README.md` → **404 Not Found** (this file does not exist in the repo at all — it is not a decode failure); `ARCHITECTURE.md` §"buzz-workflow — YAML-as-Code Automation Engine" contains the full schema: 4 trigger types (`message_posted`, `reaction_added`, `schedule`, `webhook`), 7 action types (`send_message`, `send_dm`, `set_channel_topic`, `add_reaction`, `call_webhook`, `request_approval`, `delay`), a worked YAML example, template-variable syntax, and condition-evaluation semantics — fetched 2026-09-20 | Two corrections: (1) there is no `crates/buzz-workflow/README.md` to fail to decode — the crate has no README; (2) the YAML schema the original file marked "medium confidence / unverified" is fully documented in `ARCHITECTURE.md`, a source the original research had *already fetched and cited* for the kind table on the same page — this should have been upgraded to high confidence, not left open. Also newly found: `request_approval` currently returns `StepResult::Suspended` but the engine "does not yet persist the token or resume execution — runs that hit an approval gate are marked as failed (🚧 WF-08)" — a more precise, harsher version of the README's "workflow approval gates: infra exists, glue still drying" claim. |
| README itself marks mobile clients, workflow approval gates, huddle lifecycle as "Being wired up 🚧", and web-of-trust reputation, push notifications, "culture features" as "pending code 💭" | **Confirmed** | README "Works today · Being wired up · Strong opinions, pending code" table, verbatim: 🚧 = "Mobile clients (iOS + Android, Flutter)", "Workflow approval gates (infra exists, glue still drying)", "Huddle lifecycle events"; 💭 = "Web-of-trust reputation across relays", "Push notifications", "Culture features" — fetched 2026-09-20 | None. Table contents match the original claim word-for-word. |
| ARCHITECTURE.md: "127 kind 상수 정의(집필 시점)" — buzz-core defines 127 kind constants at time of writing | **Refuted** (as a *current* count; correctly attributed as a snapshot) | `crates/buzz-core/src/kind.rs`, fetched 2026-09-20: 138 `pub const ... : u32` kind constants total; the `ALL_KINDS: &[u32]` registry (the canonical "current list" per the file's own text) contains **131** entries, not 127 | The "127" figure is ARCHITECTURE.md's own self-reported snapshot ("at the time of writing") and the original research file correctly quoted it as such — but if cited going forward, note it is already stale: the live count on 2026-09-20 is 131 in `ALL_KINDS` (138 total constants including some not in the registry). Fast-moving repo (daily-ish commits), so this number will keep drifting — treat kind counts as directional, not exact, unless re-fetched. |

No refutation above changes the file's core recommendation (do not fork/run Buzz; borrow the agent-as-member, ACP-harness, and kind-dispatch ideas). The two "Refuted" rows are about the research process (an open question that was answerable from an already-cited source, and a snapshot number that has since drifted with repo churn), not about Buzz's actual capabilities or architecture, which check out as described.
