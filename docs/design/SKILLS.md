# 오픈소스 디자인 스킬 (2026-09-20)

omnis UI 작업(Vite + React 18 + Tailwind v4 + shadcn/ui + react-icons + cmdk + react-virtuoso, Tauri 2 위)에
쓰는 Claude Code 스킬/플러그인 목록. 기준 문서는 `DESIGN-DIRECTION.md`(kinso-like, Apple/Liquid Glass,
자연스러운 spring 모션, AI-slop 금지). 리서치는 GitHub CLI(`gh`) + WebSearch로 2026-09-20에 검증했다.

프로젝트 전용 스킬은 `.claude/skills/`에 커밋되어 있다(이 레포 체크아웃이면 자동으로 로드됨). 나머지는
Logan 계정에 이미 전역 설치돼 있는 것들(`~/.claude/skills/`, `~/.claude/plugins/`)이라 이 레포와 무관하게
항상 쓸 수 있다 — 재설치하지 않고 표에만 정리했다.

## 설치 목록

| 이름 | 소스 | 라이선스 | 버전/커밋 | 호출 | 용도 | omnis 사용법 |
|---|---|---|---|---|---|---|
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) (공식 플러그인, `claude-plugins-official` 마켓플레이스로 이미 설치됨) | Anthropic 자체 LICENSE.txt (재배포 가능, 상세는 플러그인 내 LICENSE.txt) | 플러그인판 `1aa8f02ec832` (전역, user scope) | `Skill(frontend-design:frontend-design)` | AI-slop 5대 클리셰(웜크림+세리프+테라코타, 블랙+비비드 악센트, 브로드시트 하이라인, SaaS 카드킷, 트랙킹 올캡 라벨) 회피, 타이포/컬러/레이아웃을 브리프에서 도출하는 2-패스 프로세스 | 새 화면/패널을 처음부터 설계할 때 1차 방향 설정. kinso 레퍼런스가 이미 있으니 "브리프에서 팔레트 도출" 단계는 스킵하고 self-critique 체크리스트만 적용 |
| `apple-design` | 전역 스킬(`~/.claude/skills/apple-design/`), WWDC "Designing Fluid Interfaces"(2018) 번역본 — 출처 리포는 로컬 확인만(원출처 링크 없음, 전역 설치 상태 유지) | 스킬 자체는 재배포 가능한 로컬 문서(원 WWDC 콘텐츠는 Apple 소유, 패러프레이즈만) | 전역 설치본 그대로 | `Skill(apple-design)` | response(즉시 피드백)·direct manipulation(1:1 트래킹)·momentum·interruptible transition·translucency·타이포(광학 사이즈/트래킹/리딩)·reduced-motion — **웹으로 번역된** Apple 모션 원칙 | omnis의 glass 패널(sidebar/toolbar/sheet/팔레트) + spring 모션(진입 160ms/전환 240ms/레이어 320ms) 규칙의 1차 소스. 드래그형 UI(스와이프, 시트)를 만들 때 필수 |
| `apple-design-skill` | [tzzs/apple-design-skill](https://github.com/tzzs/apple-design-skill) (전역 설치됨) | MIT(`LICENSE`; HIG 원문 자체는 Apple 소유, 패러프레이즈만) | 2026-09-19 커밋 기준 | `Skill(apple-design-skill)` | HIG를 플랫폼 무관 규칙으로 정리한 감사(audit) 스킬. `references/hig/`에 색상·타이포·레이아웃·접근성·인터랙션 레퍼런스, `hig-lookup.md`가 라우팅 테이블 | 화면 완성 후 리뷰 패스에서 "HIG 위반 없나" 체크리스트로 사용(3–8개 레퍼런스만 선택 로드) |
| `avoid-ai-design` | [ungspirit](https://github.com) 작성, agentskills.io 스펙 (전역 설치됨) | MIT | v0.2.0 | `Skill(avoid-ai-design)` | HTML/CSS + React/Tailwind/shadcn 대상 AI-slop 탐지·재작성. `detect`(감사만) / `rewrite`(기본) 모드 | DeepSeek이 UI 스토리를 깎은 뒤 Sonnet 리뷰어가 `detect` 모드로 스크린샷 없이도 코드 레벨 슬롭(그라디언트, lucide 기본 아이콘, Inter 방치 등)을 1차 스캔 |
| `hallmark` | [Nutlope/hallmark](https://github.com/nutlope/hallmark) — **신규 설치**, `.claude/skills/hallmark/` | MIT | 커밋 `13ac0ec` (2026-09-20 clone) | `Skill(hallmark)` — 서브커맨드 `hallmark audit <target>` / `hallmark redesign <target>` / `hallmark study <screenshot\|URL>` | 21개 테마 카탈로그 + "slop test" 48+ 게이트(발명된 지표 금지, 토큰 락, 가짜 브라우저 크롬 금지, 모바일 4사이즈 검증, 헤더 이탤릭 금지 등) + **`study` = 레퍼런스 스크린샷에서 DNA(매크로구조/타입페어링/컬러앵커) 추출** | `docs/design/reference/*.webp`(kinso, glass-mail-ai-panel 등) 넣고 `hallmark study`로 DNA 추출 → `hallmark redesign <파일>`로 기존 컴포넌트를 kinso 룩으로 재작업. `avoid-ai-design`과 역할 분담: hallmark=신규/재설계+구조적 다양성, avoid-ai-design=기존 코드 감사·수정 |
| `motion-dev-animations` | [199-biotechnologies/motion-dev-animations-skill](https://github.com/199-biotechnologies/motion-dev-animations-skill) — **신규 설치**, `.claude/skills/motion-dev-animations/` | MIT | 커밋 `3feedfb` (2026-09-20 clone) | `Skill(motion-dev-animations)` | Motion.dev(Framer Motion 후속) 기반 spring 물리, 제스처, 스크롤, 120fps GPU 가속 패턴 + `prefers-reduced-motion` 필수화. `reference/spring-physics.md`, `templates/component-library.tsx` 포함 | DESIGN-DIRECTION.md의 spring 타이밍(160/240/320ms) 구현체를 Motion 라이브러리 코드로 옮길 때. omnis가 아직 `motion`/`framer-motion` 의존성이 없으므로 도입 시 이 스킬의 `reference/api-reference.md` 먼저 |
| `design-tokens` | [ilikescience/design-tokens-skill](https://github.com/ilikescience/design-tokens-skill) — **신규 설치**, `.claude/skills/design-tokens/` | MIT | 커밋 `787f972` (2026-09-20 clone) | `Skill(design-tokens)` | DTCG(Design Tokens Community Group) 스펙 — 토큰 타입, OKLCH/P3/sRGB 컬러 포맷, alias/resolver, 멀티플랫폼 테마 | shadcn CSS 변수 토큰(`--background`, `--accent` 등)을 라이트/다크 리졸버 구조로 확장하거나 Figma 익스포트와 동기화할 때 |
| `tailwind-v4-shadcn` | [secondsky/claude-skills](https://github.com/secondsky/claude-skills) `plugins/tailwind-v4-shadcn/skills/tailwind-v4-shadcn` — **신규 설치**, `.claude/skills/tailwind-v4-shadcn/` | MIT | 커밋 `a0994f7` (2026-09-20 clone) | `Skill(tailwind-v4-shadcn)` | omnis와 동일 스택(Tailwind v4 CSS-first `@theme inline`, shadcn/ui, Vite, React) 전용 실전 가이드 — 다크모드 ThemeProvider, `components.json`, 흔한 v4 버그(`common-gotchas.md`) | Tailwind v4/shadcn 관련 버그(테마 색이 안 먹음, `@theme` 인식 안 됨 등) 디버깅 1순위. 새 shadcn 컴포넌트 세팅 시 `templates/`의 `theme-provider.tsx`/`index.css` 참조 |
| `shadcn` (vercel 플러그인 스킬) + `mcp__shadcn__*` | Vercel 공식 플러그인(전역 설치됨) + shadcn MCP 서버(이미 연결됨) | Vercel 플러그인 라이선스(공식 마켓플레이스) | `vercel@0.49.2` | `Skill(vercel:shadcn)`, MCP 도구 `mcp__shadcn__search_items_in_registries` 등 | shadcn CLI, 커스텀 레지스트리, 컴포넌트 조합/테마 가이드 + MCP로 실시간 컴포넌트 검색·추가 명령 생성 | 새 shadcn 컴포넌트 추가 시 `mcp__shadcn__get_add_command_for_items`로 정확한 설치 커맨드를 받고, `get_audit_checklist`로 접근성 체크 |
| `chrome-devtools-mcp` (플러그인) | 공식 Chrome DevTools MCP 플러그인(전역 설치됨, `claude-plugins-official`) | 공식 플러그인 라이선스 | `v1.9.0` | `Skill(chrome-devtools-mcp:chrome-devtools)` + `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` (스크린샷, 스냅샷, 네트워크, 퍼포먼스, a11y 트레이스, lighthouse) | 실제 Tauri webview/Vite dev 서버를 열어 스크린샷·접근성 트리·콘솔·네트워크를 캡처하는 스크린샷 기반 시각 QA | 화면 완성 후 `take_screenshot`/`take_snapshot`으로 실물 캡처 → hallmark/avoid-ai-design의 슬롭 체크리스트를 스크린샷 기준으로 재적용. `a11y-debugging`, `debug-optimize-lcp` 서브스킬도 동봉 |

### 설치하지 않은 것과 이유

- **`haider-nawaz/liquid-glass-skill`, `tristan-mcinnis/apple-hig-designer-skill-2026`** (SwiftUI Liquid Glass `.glassEffect()` API 전용) — omnis는 Tauri 안의 웹뷰(React/CSS)라 SwiftUI API가 직접 적용되지 않는다. Liquid Glass를 "웹으로 번역"하는 건 이미 설치된 `apple-design`(translucency/materials 섹션)이 커버한다. macOS 26 네이티브 앱을 따로 만들게 되면 그때 재검토.
- **`ui-ux-pro-max-skill`(nextlevelbuilder)** — 79개 스타일/192개 팔레트/74개 폰트 페어링 등 방대한 로컬 데이터셋이지만 이미 kinso 레퍼런스로 방향이 고정된 omnis에는 과설계(YAGNI). 대신 `hallmark`(더 좁고 엄격한 slop-test 게이트)로 충분.
- **`ilikescience` 외 다른 design-tokens 후보(plugin87/ux-ui-agent-skills 등)** — 19개 스킬+커맨드+에이전트 번들이라 범위가 omnis 요구보다 훨씬 큼(43개 빌드 게이트, 138개 디자인시스템). 1개 스킬로 좁힌 `design-tokens-skill` 쪽이 더 라이트.
- **Playwright 전용 스킬(예: `maxrihter/claude-skill-visual-regression`)** — `chrome-devtools-mcp` 플러그인이 이미 스크린샷/스냅샷/네트워크/퍼포먼스를 MCP로 제공해서 별도 Playwright 스킬은 중복. 픽셀 diff 회귀 테스트가 실제로 필요해지면 그때 추가 검토.

## UI 태스크 표준 프롬프트 프리앰블

**UI를 건드리는 모든 태스크는 코드를 열기 전에 아래를 먼저 로드한다.**

1. `docs/design/DESIGN-DIRECTION.md` 전체 — kinso 기준, 라이트 테마, 채널 레일/행 문법, glass는 sidebar/toolbar/sheet/팔레트에만, spring 타이밍(160/240/320ms).
2. 관련 레퍼런스 이미지 1장 이상 — `docs/design/reference/kinso-inbox.webp` + 작업 영역에 맞는 나머지 3장(`ref-glass-mail-ai-panel.webp`=사이드바/AI패널, `ref-issue-tracker-density.webp`=필터/상태 pill, `ref-dashboard-detail-card.webp`=아이콘 레일/상세 카드).
3. 신규 화면/큰 재설계 → `Skill(hallmark)` (`hallmark study <레퍼런스 webp>`로 DNA 먼저 뽑고 `hallmark redesign`). 기존 코드 국소 수정 → `Skill(avoid-ai-design)` `detect` 모드로 먼저 스캔.
4. glass·모션이 들어가는 패널(사이드바/툴바/시트/팔레트/플로팅) → `Skill(apple-design)` 필수 로드. 스프링 구현 코드 필요하면 `Skill(motion-dev-animations)` 추가.
5. Tailwind v4/shadcn 세팅·버그 → `Skill(tailwind-v4-shadcn)` 먼저(`references/common-gotchas.md`), 컴포넌트 추가는 `mcp__shadcn__get_add_command_for_items`.
6. 완성 후 반드시 `chrome-devtools-mcp`로 실물 스크린샷 캡처 → `Skill(apple-design-skill)`(HIG 감사) + `Skill(avoid-ai-design)` `detect` 재확인.

## 12줄 Anti-AI-Slop 체크리스트

(`frontend-design` §5대 클리셰 + `hallmark` slop-test 게이트 + `avoid-ai-design` 카탈로그 + omnis `POLISH-LOG.md` 실제 발견 사례를 종합)

1. 웜크림 배경 + 세리프 디스플레이 + 테라코타(#D97757 근방) 악센트 조합 금지 — Claude 자체 톤으로 읽힘.
2. 균일한 카드 그리드에 전부 같은 border-radius + 같은 `rgba(0,0,0,.1)` 소프트 섀도 금지 — 위계 없는 "SaaS 카드킷".
3. 보라/파랑 그라디언트를 장식으로 남발 금지 — 쓸 거면 왜 그 색인지 답할 수 있어야 함.
4. 헤딩에 이탤릭 강조나 단어 1개만 색/볼드 강조 금지 — weight나 언더라인으로 대체.
5. 트래킹 올캡 라벨, 미들닷 메타(`A · B · C`), 스페이스 em-dash(`WORD — fragment`) 같은 "템플릿 크롬" 금지.
6. 근거 없는 지표(`+47% 전환`, `10× 빠름`) 발명 금지 — 실측 없으면 `—`나 라벨 처리.
7. 가짜 브라우저 바(URL 필+트래픽라이트 점)·가짜 폰 프레임 직접 그리기 금지 — 실제 스크린샷 사용.
8. lucide/heroicons 기본 아이콘을 의미 없이 나열 금지 — 브랜드 아이콘은 `react-icons/si`, 기능 아이콘은 의미가 있을 때만.
9. 정적 진입(즉시 나타남) 또는 카드마다 fade-up 반복 금지 — 진입은 spring(160/240/320ms) 한 번, 과장 금지.
10. `prefers-reduced-motion` 무시 금지 — 모든 spring/트랜지션에 감속 대체 경로 필수.
11. 모바일 4사이즈(320/375/414/768px) 중 하나라도 가로 스크롤 발생하면 실패로 간주.
12. 선택되지 않은 리스트 행에 헤어라인/섀도 남발 금지 — kinso 규칙(헤어라인 없음, 선택된 행만 카드로 elevate)을 지킨다.

## 참고

- 컴포넌트/코드 레벨 OSS 차용 계획(shadcn 호환 킷, 메일 클라이언트 패턴, 에이전트 상태 UI 등)은 스킬이 아니라 라이브러리 리서치라 `docs/research/30-herdr-and-oss-ui-borrow.md`에 별도로 있다 — 이 문서와 역할이 다르다(여기는 "Claude Code가 UI를 짤 때 로드하는 지식/체크리스트", 그쪽은 "가져다 쓸 컴포넌트 코드").
