# "Google Artemis" (2026) — 정체 확인 및 omnis 모바일 전략에 대한 시사점

Fetched 2026-09-20.

## 1. TL;DR

"Google Artemis"는 **오픈소스 Android UI 자동화 프레임워크**다 (github.com/google/artemis, Apache 2.0, 2026-09-10 공개). Google Pixel Test Engineering Fusion 팀이 만들었고, 자연어 지시를 실제 폰 조작으로 바꿔 AndroidWorld 벤치마크에서 99%+를 찍는다. Antigravity·Claude Code·Codex·Cursor에 MCP 서버로 붙어서, "IDE 채팅창에서 실물 Android 폰을 조작"하는 용도다. **QA/테스트 자동화 도구**이지 소비자용 "everything is an inbox" 앱이 아니고, **Android 전용**(iOS는 로드맵 항목일 뿐 미구현)이다. Logan이 언급한 Gemini I/O 발표(Gemini Intelligence on Android, 2026-05)와는 다른 프로젝트다. omnis에 직접 이식할 건 적지만, MCP 기반 "자연어→기기 조작" 패턴과 Flash/Pro 이중 프로파일 구조는 향후 KakaoTalk 캡처(Mac mini) 자동화 설계에 참고할 만하다. iOS 지원이 없어 iPhone 클라이언트 목표와는 직접 안 맞는다.

## 2. Facts

- **VERIFIED** — `google/artemis`는 GitHub 공개 저장소, Apache-2.0 라이선스, Python 기반, 8,111 stars, 생성일 2026-08-13, 최근 push 2026-09-12. Source: https://github.com/google/artemis (fetched 2026-09-20, via `gh repo view`)
- **VERIFIED** — README 설명: "ARTEMIS turns natural-language instructions into reliable Android automation... integrates seamlessly with AI coding assistants such as Antigravity, Codex, and Claude Code... 99%+ success rate on AndroidWorld Benchmark." Source: `gh api repos/google/artemis/readme` (fetched 2026-09-20)
- **VERIFIED** — 빌더/공개일: Google **Pixel Test Engineering Fusion team**이 2026-09-10에 오픈소스로 공개. Source: https://alphasignal.ai/news/google-s-artemis-hits-99-on-android-tasks-where-most-agents-fail (fetched 2026-09-20)
- **VERIFIED** — 플랫폼: **Android 전용**. README 로드맵에 "iOS Platform Expansion: Extending multimodal perception and mobile automation to iOS devices and simulators"가 미완료 항목으로 명시됨 → 현재 iOS 미지원. Source: GitHub README (fetched 2026-09-20)
- **VERIFIED** — 통합 방식: **Model Context Protocol(MCP) 네이티브 서버** 제공. Antigravity, Claude Code, Codex, Windsurf, Cursor, VS Code, Cline/Roo에 설치 가능(`artemis mcp --install <client>`). Source: GitHub README (fetched 2026-09-20)
- **VERIFIED** — 실행 모델: **Flash 프로파일**(반응형 loop, 스텝당 3–5초, 계획/검증 없음)과 **Pro 프로파일**(Planner+Operator+Checker 멀티에이전트, 스텝당 15–40초, pre-execution safety net, 최종 검증)의 이중 구조. Source: GitHub README (fetched 2026-09-20)
- **VERIFIED** — 모델 아그노스틱: Gemini, Claude, GPT-4o, Qwen-VL 지원 (특정 모델에 락인되지 않음). Source: GitHub README (fetched 2026-09-20)
- **VERIFIED** — 온디바이스 요소: 첫 태스크 실행 시 폰에 **Artemis Accessibility Helper**(접근성 서비스, 화면 레이아웃만 읽음, "sends nothing elsewhere")를 설치. UIAutomator2 폴백 가능. 코어 동작에 클라우드 의존성 없음(모델 호출 제외). Source: GitHub README (fetched 2026-09-20)
- **VERIFIED** — 벤치마크: Google Research의 **AndroidWorld**(20+ 앱, 100+ 멀티스텝 태스크) 벤치마크에서 99%+ 완료율(SOTA 주장). Source: GitHub README + AlphaSignal (fetched 2026-09-20)
- **⚠️ 논란 — VERIFIED (출처: 이해당사자 블로그, 검증되지 않은 주장 포함)** — 경쟁사 **Minitap, Inc.**(오픈소스 `mobile-use` 프로젝트 저작자)가 Artemis가 자사 코드를 저작권 표시 없이 가져갔다고 공개 비판: "디바이스 연결 코드가 정확히 일치", "Hopper 에이전트 지시문이 토씨 하나 안 틀리고 동일", 초기 버전에 원저자 이름(Pierre-Louis Favreau 등)이 있다가 force-push로 삭제됨. Google artemis README 자체는 "includes source code developed by Minitap, Inc."라고 하단에 명시(사후 반영으로 보임). Source: https://www.minitap.ai/blog/i-expected-better-from-google (fetched 2026-09-20) — **UNVERIFIED**: Google 측의 반박/공식 답변은 검색되지 않음, 이 주장은 Minitap 자체 블로그(당사자 주장)이므로 단독 사실로 취급 금지.
- **VERIFIED** — Google I/O 2026(2026-05-19~20)의 공식 키노트/발표 목록에는 "Artemis"라는 이름이 등장하지 않음. I/O에서 나온 모바일 에이전트 관련 발표는 별개 프로젝트인 **"Gemini Intelligence on Android"**(2026-05, Android Show I/O Edition에서 발표, 프로액티브 작업 수행·웹 요약·폼 자동완성, 삼성/구글폰에 여름 롤아웃). 이는 소비자용 시스템 기능이며 오픈소스가 아니고 Artemis와 무관. Source: https://blog.google/products-and-platforms/platforms/android/gemini-intelligence/ (검색 스니펫으로 확인, 원문 직접 페치는 404; fetched 2026-09-20)
- **VERIFIED** — 비교 대상 오픈소스 프로젝트 존재: `mobile-next/mobile-mcp` (Apache-2.0, TypeScript, 6,763 stars, **iOS+Android+에뮬레이터/시뮬레이터 모두 지원**), `droidrun/mobilerun`(Android+iOS, LLM 아그노스틱, 자체 벤치마크 63% on 116 tasks). Source: `gh repo view mobile-next/mobile-mcp`, WebSearch droidrun (fetched 2026-09-20)

## 3. Options / 비교표

| 항목 | Google **Artemis** | Minitap **mobile-use / mini** | **mobile-mcp** (mobile-next) | **droidrun/mobilerun** |
|---|---|---|---|---|
| 라이선스 | Apache-2.0 (오픈) | 오픈소스 코어 있음, 상용 "mini"는 closed | Apache-2.0 (오픈) | 오픈소스 |
| Android | O (99%+ AndroidWorld) | O | O | O (63% on 116 tasks, 자체 벤치마크) |
| iOS | ✕ (로드맵만) | O (mini 제품) | **O** | O |
| MCP 지원 | O (네이티브 서버) | 일부 | O (핵심 설계) | 일부 |
| 통합 대상 | Antigravity/Claude Code/Codex/Cursor/Windsurf | 자체 QA 제품 | Claude Code/Codex/Gemini/Copilot/Antigravity | CLI/Docker/Python |
| 성격 | 개발자용 테스트·자동화 도구 | 상용 모바일 QA SaaS | 범용 MCP 서버 | 범용 에이전트 프레임워크 |
| star 수 | 8,111 | 비공개 | 6,763 | 다수(포크 다수, 정확한 원본 수 미확인) |
| omnis 적합성 | 낮음(Android 전용, iPhone과 무관) | 낮음(closed, QA 특화) | **중간** (iOS 지원이 핵심 차별점) | 중간 |

Artemis 자체는 omnis에 낮은 적합성 — Logan의 클라이언트는 iPhone이고, KakaoTalk 캡처는 Mac mini(macOS)에서 이뤄진다. Android 전용 도구는 직접 쓸 데가 없다.

## 4. Recommendation for omnis

**채택하지 않는다.** Artemis를 omnis 파이프라인에 직접 통합하는 건 권장하지 않는다.

- **왜**: (1) omnis의 두 클라이언트는 MacBook Pro와 iPhone — 둘 다 Android가 아니다. (2) API-less 채널 캡처 대상(KakaoTalk)은 macOS 앱이지 Android 앱이 아니다 (브리프에 Mac mini에서 KakaoTalk.app 설치라고 명시). (3) Artemis는 "테스트 자동화"에 최적화된 도구로, 상시 백그라운드 인박스 폴링/알림 파싱과는 설계 목적이 다르다(태스크당 3~40초 소요되는 관찰-행동 루프는 실시간 인박스 유스케이스에 비효율).
- **효과 산정**: S — 도입 여부 자체를 재고할 필요 없음, 통합 시도 시 M(iOS 미지원이라 어댑터를 새로 짜야 함, 사실상 무의미).
- **리스크**: Artemis를 Android 앱 조작에 쓴다면 접근성 서비스 설치가 필요하고 카카오 등 앱의 ToS(자동화 금지 조항)를 건드릴 수 있음 — 원 브리프의 "API-less 채널은 계정 정지 리스크" 우려와 동일선상. Minitap의 저작권 분쟁도 Google 프로젝트 자체의 거버넌스 리스크를 시사(코드 출처 불투명) — 프로덕션 의존성으로 삼기엔 신뢰도 낮음.
- **대신 참고할 것**: iOS까지 지원하는 `mobile-next/mobile-mcp`가 "OS 네이티브 앱을 MCP로 조작"이 실제로 필요해지는 시점(예: KakaoTalk을 macOS 접근성 API로 못 잡고 UI 자동화로 우회해야 하는 경우)에 더 맞는 후보다. 단, 이것도 지금 당장 우선순위는 아니다 — omnis MVP는 API가 있는 채널(Slack/Gmail/Telegram) 우선이 맞다.

## 5. What to borrow (패턴만)

기술 자체보다 **아키텍처 패턴**이 참고 가치 있다:

1. **Flash/Pro 이중 프로파일 분리** (README "Execution Profiles" 섹션): 빠르고 결정적인 태스크(예: "이 메일 라벨 붙이기")는 계획 없는 반응형 루프로, 복잡한 판단(예: "이 스레드에 뭐라고 답장할지 결정")은 Planner+Checker가 있는 무거운 루프로 — omnis의 "context-aware reply drafts"와 "auto-labeling"을 설계할 때 이 이분법을 그대로 쓸 수 있다. 가벼운 라벨링/필터링 = Flash형, 답장 초안 생성/CRM 팔로업 판단 = Pro형.
2. **MCP 서버로 "에이전트가 에이전트를 조작"**: Artemis가 IDE 에이전트(Claude Code 등)에게 "실물 기기"를 MCP 툴로 노출하는 방식은, omnis가 목표로 하는 "Claude Code/Codex/DeepSeek/Hermes 세션이 서로의 세션을 인지하고 조작"하는 것과 같은 패턴이다. Artemis의 `mcp_server/rules.md`(행동 규칙을 별도 파일로 분리해 IDE 룰로 마운트하는 방식)는 omnis의 agent-session-as-inbox-thread 설계에서 "에이전트가 다른 에이전트 세션에 개입할 때 지켜야 할 규칙"을 문서화하는 방법으로 참고 가능.
3. **온디바이스 헬퍼 최소화 원칙**: Artemis 헬퍼는 "화면 레이아웃만 읽고 아무 데도 안 보낸다"는 프라이버시 문구를 명시(README "What ARTEMIS Installs on Your Phone"). omnis가 iPhone/Mac에 상주 프로세스를 깔 때(알림 캡처 등) 이런 최소 권한·투명성 문구를 사용자 대면 문서에 넣는 패턴으로 차용 가능.
4. **저작권/출처 표기 교훈**: Minitap 분쟁은 omnis가 오픈소스 컴포넌트를 가져다 쓸 때 라이선스·저작자 표시를 꼼꼼히 지켜야 한다는 반면교사. 특히 Vercel AI SDK나 다른 OSS를 포크/변형할 계획이 있다면 주의.

파일 경로 포인터: 참고할 게 있다면 omnis 리포 내 미래의 `mac-mini-capture/`(가칭) 또는 `agent-orchestration/` 모듈 설계 문서에 위 3개 패턴을 원칙으로만 적어두면 충분 — 코드 이식은 불필요(플랫폼이 다름).

## 6. Open questions

- Gemini Intelligence on Android(소비자용, 2026-05 I/O 발표)가 실제로 출시되어 Logan의 안드로이드/삼성 기기에서 쓸 수 있는 상태인지, 그리고 그게 Logan이 원래 의도한 "artemis"였을 가능성 — Logan에게 원문 맥락(어디서 "artemis"란 단어를 봤는지) 재확인 필요.
- Artemis의 Minitap 코드 출처 논란에 대해 Google의 공식 대응이 있었는지(이후 커밋 로그나 공지) — 이번 조사에서는 확인 못함(UNVERIFIED).
- `mobile-mcp`(iOS 지원)를 omnis가 실제로 필요로 할 시점 — KakaoTalk 캡처를 macOS 앱 자동화로 할지, 아니면 별도 API/브릿지로 할지 아키텍처 결정이 먼저 필요. 이 결정이 나면 mobile-mcp 채택 여부를 재평가.
- Artemis의 on-device VLM 로드맵("On-Device Lightweight VLMs" — 로컬 실행, 프라이버시 우선)이 Apple Silicon(M4/M5) 로컬 모델 활용이라는 omnis 목표와 방향은 같음 — Artemis가 이걸 어떻게 구현하는지는 아직 로드맵 단계라 추적 가치 낮음, 6개월 후 재확인 권장.

## 7. Sources

- https://github.com/google/artemis (repo, README) — fetched 2026-09-20
- https://alphasignal.ai/news/google-s-artemis-hits-99-on-android-tasks-where-most-agents-fail — fetched 2026-09-20
- https://www.minitap.ai/blog/i-expected-better-from-google — fetched 2026-09-20 (당사자 주장, 저작권 분쟁)
- https://blog.google/products-and-platforms/platforms/android/gemini-intelligence/ — fetched 2026-09-20 (검색 스니펫 확인, 직접 fetch 404)
- https://github.com/mobile-next/mobile-mcp — fetched 2026-09-20
- https://github.com/droidrun/mobilerun — fetched 2026-09-20 (검색 스니펫)
- https://medium.com/coding-nexus/google-artemis-the-open-source-ai-agent-that-can-control-your-android-phone-747bf7ce3d20 — fetched 2026-09-20 (2차 출처, 교차검증용)
- Google I/O 2026 공식 페이지 (blog.google/innovation-and-ai/technology/ai/google-io-2026-all-our-announcements/) — 검색 스니펫으로 "Artemis" 미등장 확인, 2026-09-20

## Verification (adversarial)

Re-checked 2026-09-20 against primary sources: `gh repo view google/artemis`, `gh api repos/google/artemis/readme` (full 318-line README fetched and read in full, not just a snippet), `gh repo view mobile-next/mobile-mcp`, `gh repo view droidrun/mobilerun`, and direct fetches of alphasignal.ai, minitap.ai, blog.google, mobilerun.ai/benchmark. 11 gh/web lookups performed. Default posture: unverifiable unless a primary source (Google's own repo/README, or the claimant's own site for self-claims) backs it.

| # | Claim | Verdict | Evidence URL | Correction |
|---|---|---|---|---|
| 1 | google/artemis: Apache-2.0, 8,111 stars, created 2026-08-13, pushed 2026-09-12, Python | CONFIRMED | https://github.com/google/artemis (`gh repo view`/`gh api repos/google/artemis`, fetched 2026-09-20) | Live count is 8,112 stars (+1) — normal drift, not material. All other fields exact match. |
| 2 | Built/released by Google's Pixel Test Engineering Fusion team on 2026-09-10 | **UNVERIFIABLE** (was marked "high confidence VERIFIED" — overstated) | AlphaSignal only: https://alphasignal.ai/news/google-s-artemis-hits-99-on-android-tasks-where-most-agents-fail (fetched 2026-09-20) | Checked README.md (full text) and CONTRIBUTING.md in google/artemis directly — neither names "Pixel Test Engineering," "Fusion team," or any internal team. No Google blog post, press release, or repo file corroborates this attribution; it traces to a single secondary news aggregator (AlphaSignal), not Google. Should be downgraded from "confirmed/high confidence" to "reported by one secondary source, no Google primary confirmation found." |
| 3 | Android-only; iOS is an unchecked roadmap item | CONFIRMED | README `## Roadmap` section: `- [ ] **iOS Platform Expansion**: Extending multimodal perception and mobile automation to iOS devices and simulators.` (fetched 2026-09-20) | None. |
| 4 | Native MCP server integrating Antigravity, Claude Code, Codex, Cursor, Windsurf | CONFIRMED | README `#mcp-setup` section, fetched 2026-09-20 | None — README's Quick Start explicitly lists all five (plus VS Code, Cline/Roo, OpenClaw) as IDEs the one-click installer configures with the MCP server + rules; the "Mount Behavioral Rules" subsection gives per-IDE install steps for each of the five named tools individually. |
| 5 | 99%+ on AndroidWorld (100+ multi-step tasks, 20+ apps) | CONFIRMED | README `## Benchmarks: AndroidWorld (SOTA 99%+)`, fetched 2026-09-20 | None. |
| 6 | Flash (~3–5s/step, no planning) vs. Pro (~15–40s/step, Planner/Operator/Checker, safety checks) | CONFIRMED | README `## Execution Profiles: Flash vs. Pro`, fetched 2026-09-20 | None — wording matches almost verbatim. |
| 7 | I/O 2026 did not announce "Artemis"; separate closed feature "Gemini Intelligence on Android" exists | CONFIRMED | https://blog.google/products-and-platforms/platforms/android/gemini-intelligence/ (fetched 2026-09-20, page loaded this time, no "Artemis" mention found in full text) | Minor date nuance: Gemini Intelligence was announced 2026-05-12 at the "Android Show 2026" event, not at I/O itself (I/O was 2026-05-19/20) — the original file's "Android Show I/O Edition" phrasing is directionally correct but the two events are formally distinct. The I/O all-announcements URL still 404s for direct fetch (same as original finding); absence of "Artemis" there remains a search-snippet-level check, not a full-page read. |
| 8 | Minitap alleges Artemis copied its code (connection code, identical Hopper agent instructions, force-pushed-away author names); README now credits Minitap | CONFIRMED | https://www.minitap.ai/blog/i-expected-better-from-google (fetched 2026-09-20, primary source — Minitap's own post); README line 318, fetched 2026-09-20: `This project includes source code developed by [Minitap, Inc.](https://github.com/minitap-ai/mobile-use).` | None on the core allegations (self-interested party, appropriately hedged as "medium confidence" in the original — correctly not upgraded to fact). Confirmed no Google public rebuttal exists as of fetch date. |
| 9 | mobile-next/mobile-mcp: Apache-2.0, TypeScript, 6,763 stars, iOS+Android | CONFIRMED | `gh repo view mobile-next/mobile-mcp`, fetched 2026-09-20 | None — exact star-count match. |
| 10 | On-device Accessibility Helper reads screen layout only, sends nothing elsewhere; no cloud dependency besides the chosen LLM | CONFIRMED | README `## What ARTEMIS Installs on Your Phone`, fetched 2026-09-20 | None on the direct quote ("It listens only on the phone itself and sends nothing elsewhere"). "No cloud dependency for core execution besides the chosen LLM" is the original researcher's paraphrase, not a verbatim README claim, but it is a reasonable reading — no contradicting evidence found. |
| extra | droidrun/mobilerun: "own benchmark 63% on 116 tasks" | **REFUTED** | https://mobilerun.ai/benchmark and https://github.com/droidrun/mobilerun (fetched 2026-09-20) | Current published number is **91.4% (106/116 tasks)**, and the benchmark is explicitly **AndroidWorld** (the same benchmark Artemis uses), not an unnamed "own benchmark." Repo has **9,420 stars** (more than Artemis's 8,112 and mobile-mcp's 6,763) and is MIT-licensed. The comparison table's "다수(포크 다수, 정확한 원본 수 미확인)" undercounts this materially. |

### Corrected recommendation

The core recommendation — do not adopt Artemis for omnis (Android-only, wrong OS for both of Logan's clients, test-automation loop latency mismatched to a live-inbox use case) — **stands; none of the refutations above overturn it.** Two adjustments to the supporting detail:

1. **Drop or hedge the "Fusion team, 2026-09-10" attribution** (claim #2) when citing this research elsewhere — it rests on one secondary aggregator (AlphaSignal), not on Google's own README, CONTRIBUTING.md, or a blog post. Cite it as "reported by AlphaSignal," not as a Google-confirmed fact.
2. **Elevate droidrun/mobilerun, not just mobile-mcp, as the reference candidate for §4/§6** ("what to borrow" / future iOS+Android automation). It scores 91.4% on the *same* AndroidWorld benchmark Artemis claims 99%+ on, supports iOS natively, is LLM-agnostic across seven providers, and has the largest star count of the three projects compared (9,420 vs. 8,112 vs. 6,763). If omnis ever needs a macOS/iOS UI-automation fallback for API-less channels (the KakaoTalk scenario flagged in §4/§6), droidrun/mobilerun — not just mobile-mcp — deserves a direct trial, since it already has a public cross-platform AndroidWorld result to compare against Artemis's, whereas mobile-mcp's README does not publish a comparable benchmark number.
