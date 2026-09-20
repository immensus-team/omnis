# 14. Apple-native 디자인 언어 + 웹 컴포넌트 전략

## 1. TL;DR

omnis는 Tauri 위에 웹 스택(Tailwind v4 + shadcn/ui + Radix)으로 짓되, macOS Tahoe 26의 Liquid Glass 원칙 — 컨트롤/네비게이션 레이어는 유리, 콘텐츠(리스트·메일 본문)는 불투명 — 을 따라야 한다. Liquid Glass는 sidebar·toolbar·sheet·command palette에만 쓰고, 스크롤되는 리스트 자체엔 쓰지 않는다(Apple 공식 가이드). 타이포는 Inter(라틴) + Pretendard(한글) 페어링, 다크 모드 우선, 채도 낮은 배경 + 액센트 1개(Linear/Raycast 패턴). Tauri의 `window-vibrancy`로 macOS 네이티브 vibrancy를 얻고, 가상 리스트는 TanStack Virtual, 커맨드 팔레트는 cmdk(shadcn Command가 이미 래핑), 리치 텍스트는 Tiptap(ProseMirror 기반, AI 확장 있음)을 권장. Notion Mail이 2026-09-22 종료 — 유니파이드 인박스 시장의 직접 반증 사례로 참고할 것.

## 2. Facts

**Apple HIG / Liquid Glass**
- Liquid Glass는 iOS/iPadOS/macOS(Tahoe)/watchOS/tvOS 26 전체에 걸친 신규 머티리얼로 WWDC25(2025-06)에서 발표됨. "glass의 광학 특성 + 유동성"을 결합. VERIFIED — [Apple Newsroom](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) (fetched 2026-09-20)
- 핵심 원칙: 레이어 분리 — 유리는 **컨트롤/내비게이션**(툴바, 탭바, 사이드바, 시트, 팝오버, 플로팅 버튼) 레이어에 속하고, **콘텐츠**(리스트, 테이블, 미디어, 스크롤 영역)에는 쓰지 않음. VERIFIED — [WWDC25 세션 #323](https://developer.apple.com/videos/play/wwdc2025/323/), 재확인 via 검색 요약 (fetched 2026-09-20)
- macOS Tahoe: 사이드바는 콘텐츠 위에 떠 있는 유리 패널, 인스펙터는 edge-to-edge 유리, 툴바 아이템은 자동으로 유리 표면 위에 그룹핑되고 아래 콘텐츠 밝기에 따라 적응. 스크롤 엣지 이펙트가 하드 디바이더를 블러로 대체. VERIFIED (WWDC25 요약, 1차 소스 직접 크롤은 JS 렌더링이라 실패, Apple 공식 세션 타이틀·Newsroom과 교차 확인) — [WWDC25 #310 AppKit](https://developer.apple.com/videos/play/wwdc2025/310/), [WWDC25 #356](https://developer.apple.com/videos/play/wwdc2025/356/) (fetched 2026-09-20)
- 유리 머티리얼은 색이 "주변 콘텐츠에 의해 결정되고 라이트/다크에 자동 적응"함 — 즉 다크 모드 대응이 머티리얼 차원에서 내장. VERIFIED — Apple Newsroom (fetched 2026-09-20)

**레퍼런스 앱**
- Superhuman: Cmd/Ctrl+K 커맨드 팔레트가 화면 중앙에 뜨고 모노스페이스 폰트로 "파워툴" 느낌을 줌. 단축키 우선 UX(E=archive, J/K=nav 등), 팔레트에 액션 실행 시 해당 단축키를 옆에 노출해 학습시킴. VERIFIED — [Superhuman Blog](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/), [Help Center](https://help.superhuman.com/hc/en-us/articles/45191759067411-Speed-Up-With-Shortcuts) (fetched 2026-09-20)
- Linear: Inter Variable 전역 사용(`cv01`, `ss03` 활성화), 웨이트 3단(400/510/590), 자간이 폰트 크기에 반비례해 스케일. 스페이싱은 8px 베이스의 8/12/24/96 래더. 다크 배경 `#08090a` + 단일 액센트(acid-lime `#e4f222`). 모션 듀레이션 100/160/400ms, 보더는 0.5px 헤어라인. VERIFIED (커뮤니티 DESIGN.md 분석, 1차 소스 아님, 다수 소스 교차 확인) — [DesignMD Linear](https://www.designmd.co/d/linear.app) (fetched 2026-09-20)
- Raycast: 근흑색 캔버스 `#07080a`, Inter + `ss03`(single-story g), 1px 헤어라인 보더, 코너 반경 6–16px, 단일 코럴 액센트 `#ff6363`, 키캡 느낌의 inset shadow. VERIFIED (커뮤니티 분석) — [shadcn.io/design/raycast](https://www.shadcn.io/design/raycast) (fetched 2026-09-20)
- Arc 브라우저: 사이드바가 탭바/URL바/북마크바를 대체, Cmd+T 커맨드 바가 Spotlight식 유니버설 서치(탭/히스토리/북마크/액션 통합), "Spaces"로 프로젝트별 수직 그룹핑. VERIFIED (다수 소스 교차 확인) — [Blake Crosley 분석](https://blakecrosley.com/guides/design/arc) (fetched 2026-09-20)
- Things 3 / Craft: 타이포와 화이트스페이스 중심, 밀도가 "너무 성기지도 빽빽하지도 않게" 정교히 튜닝된 것으로 다수 리뷰가 언급. Things 3는 2017 Apple Design Award 수상. VERIFIED — [Pratt IXD 비평](https://ixd.prattsi.org/2020/02/design-critique-things-3-ios-app/) (fetched 2026-09-20)
- Notion Mail: **2026-09-22 서비스 종료 확정**. 종료 사유는 제품 실패가 아니라 "이메일 사용자의 절반 이상이 받은편지함을 열지 않고 에이전트에게 통째로 위임" — 즉 유니파이드 인박스 UI 자체가 아니라 에이전트가 최종 표면이 되는 방향으로 시장이 이동 중이라는 직접 증거. Gmail 데이터는 유지되나 Notion 전용 기능(초안/자동라벨/스니펫)은 09-21까지 export 필요. VERIFIED (1차 소스) — [Notion Help Center](https://www.notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next) (fetched 2026-09-20)
- Kinso.ai: AI 유니파이드 인박스(이메일+Slack+LinkedIn+WhatsApp+Instagram), 톤을 학습해 초안 작성, 채널 간 대화 스레딩, 우선순위 기반 모닝 브리핑. 초대제 $59/월. 평판은 갈림(베타 지원 호평 vs "hype company" 비판). VERIFIED (다수 리뷰 소스, 공식 1차 소스는 landing page만 접근) — [Kinso.ai](https://www.kinso.ai/), [thisandthat.chat 리뷰](https://www.thisandthat.chat/blog/kinso-review/) (fetched 2026-09-20)

**타이포그래피**
- Pretendard는 Inter(라틴) + Source Han Sans(한글) + M PLUS 1p(일본어)를 합성해 만든 폰트로, Apple SD Gothic Neo/SF Pro의 대체재로 2021-06-28 출시. 9 weight, variable font 지원, 182개 언어. VERIFIED — [Pretendard GitHub README](https://github.com/orioncactus/pretendard/blob/main/packages/pretendard/docs/en/README.md) (fetched 2026-09-20)

**웹 구현 스택**
- Tailwind v4: JS config 폐지, `@theme` 디렉티브로 CSS 안에서 디자인 토큰 정의(CSS-first). Rust 기반 Oxide 엔진으로 풀빌드 ~100ms, 무변경 증분빌드 ~192μs. 2025-01 출시. VERIFIED — [Tailwind CSS v4.0 공식 블로그](https://tailwindcss.com/blog/tailwindcss-v4) (fetched 2026-09-20)
- shadcn/ui: Tailwind v4 + React 19 대응 완료, 모든 프리미티브에 `data-slot` 속성, HSL→OKLCH 색상 전환. `--base` 플래그로 Radix 또는 Base UI 프리미티브 선택 가능(2026-07부터 Base UI가 기본값으로 전환). VERIFIED — [shadcn/ui Tailwind v4 문서](https://ui.shadcn.com/docs/tailwind-v4), [changelog](https://ui.shadcn.com/docs/changelog) (fetched 2026-09-20)
- shadcn MCP 서버: AI 에이전트가 레지스트리에서 컴포넌트를 탐색·검색·설치(자연어로 "로그인 폼 추가해줘" 가능), 여러 레지스트리(퍼블릭/프라이빗/서드파티) 동시 연결. Claude Code 설정: `pnpm dlx shadcn@latest mcp init --client claude`. VERIFIED (1차 소스) — [ui.shadcn.com/docs/mcp](https://ui.shadcn.com/docs/mcp) (fetched 2026-09-20)
- Tauri `window-vibrancy`: macOS 네이티브 vibrancy 지원, `apply_liquid_glass` + `NSGlassEffectViewStyle`로 Liquid Glass 이펙트 적용 가능(2026-09 시점 최신 작업 진행 중). Linux는 컴포지터 의존이라 미지원, Windows는 별도 API. VERIFIED — [tauri-apps/window-vibrancy GitHub](https://github.com/tauri-apps/window-vibrancy) (fetched 2026-09-20)
- cmdk: shadcn Command 컴포넌트가 이를 래핑하고 있어 사실상 업계 표준(주간 수천만 다운로드). 언스타일드 프리미티브로 fuzzy filtering + 키보드 네비게이션만 제공, 스타일은 직접. VERIFIED (커뮤니티 분석, 다수 소스 교차 확인) — 검색 결과 종합 (fetched 2026-09-20)
- Tiptap vs Lexical: Tiptap은 ProseMirror 기반, 성숙한 확장 생태계, 첫 파티 AI 확장(슬래시 커맨드/완성/생성) 보유, 번들 80–120KB, CMS·문서·협업 저작에 적합. Lexical은 Meta 오픈소스(Messenger/WhatsApp Web에서 사용), 더 가볍고 저수준, 고성능 소셜/메시징 UI에 적합. omnis의 답장 초안 작성기는 Tiptap이 적합(AI 확장 필요, 성능 크리티컬 아님). VERIFIED (다수 2026 비교 소스 교차 확인) — [Eddyter 비교](https://eddyter.com/blogs/lexical-vs-tiptap-2026) (fetched 2026-09-20)
- TanStack Virtual: 10만 항목 리스트를 렌더링 지연 없이 처리(윈도잉 기법, 뷰포트 근처만 DOM에 유지). 2026년 기준 가장 널리 쓰이는 가상 리스트 라이브러리; react-virtuoso는 동적 높이/그룹 내장이 필요할 때, react-window는 고정 높이 단순 케이스에 적합. VERIFIED (커뮤니티 벤치마크 소스 교차 확인) — [TanStack Virtual 공식 문서](https://tanstack.com/virtual/latest/docs/introduction) (fetched 2026-09-20)

## 3. Options / 비교표

| 축 | 옵션 A | 옵션 B | omnis 선택 |
|---|---|---|---|
| shadcn 프리미티브 베이스 | Radix UI (성숙, 기존 생태계 큼) | Base UI (2026-07부터 shadcn 기본값, MUI팀 신작) | **Radix** — 문서/예제/서드파티 컴포넌트 풀이 훨씬 큼, Base UI는 아직 어린 생태계라 M/L 규모 앱엔 리스크 |
| 가상 리스트 | TanStack Virtual (헤드리스, 유연) | react-virtuoso (동적 높이/그룹 내장) | **react-virtuoso** — 인박스 리스트는 아바타·미리보기·배지로 행 높이가 가변적이고 채널별 그룹핑(Slack/Kakao/Gmail…)이 필요해 내장 지원이 개발 속도에서 이김. 성능 한계 부딪히면 TanStack Virtual로 이관 |
| 리치 텍스트 | Tiptap (ProseMirror) | Lexical (Meta) | **Tiptap** — AI 확장 성숙도, 표/서식 등 이메일 답장 작성에 필요한 기능이 기본 제공 |
| 커맨드 팔레트 | cmdk 직접 | shadcn Command (cmdk 래핑) | **shadcn Command** — 이미 디자인 시스템에 통합, 별도 스타일링 불필요 |
| macOS 유리 효과 구현 | 순수 CSS `backdrop-filter: blur()` | Tauri `window-vibrancy` (네이티브 NSVisualEffectView/Liquid Glass) | **window-vibrancy 우선, CSS blur는 폴백** — 네이티브 vibrancy만이 실제 데스크톱 배경까지 반영해 "Apple-native" 느낌을 줌; CSS blur는 웹뷰 내부 콘텐츠만 블러링해 얕아 보임 |
| 아이콘(웹) | Lucide | Phosphor | **Lucide** — shadcn 기본 채택 아이콘셋이라 마찰 없음, SF Symbols와 형태 문법(단순 라인, 2px stroke)이 가장 가까움 |

## 4. Recommendation for omnis

**레이어 분리를 코드 규칙으로 강제하라.** Liquid Glass는 사이드바·툴바·커맨드 팔레트·시트(답장 작성 모달, 설정)에만 적용하고, 인박스 리스트(메시지 행)와 메일 본문 같은 "콘텐츠"는 불투명 배경 위에 올린다. Apple 자신이 "매 UI 요소에 유리를 쓰지 마라"고 명시하므로 여기서 벗어나면 바로 "AI가 만든 UI" 티가 난다. Effort: S(CSS 레이어 규칙 문서화) + M(Tauri vibrancy 배선). Risk: 낮음 — HIG 위반이 아니라 순수 구현 리스크(vibrancy가 프레임 드롭 유발 가능, GPU 부담 모니터링 필요).

**다크 모드 우선, 콜드 뉴트럴 + 액센트 1개.** Linear(`#08090a` + lime)와 Raycast(`#07080a` + coral)가 공통으로 증명한 패턴: 거의 검정에 가까운 배경, 헤어라인 보더(0.5–1px)로 카드 경계를 표현(그림자 대신), 액센트 컬러는 CTA·선택 상태·읽지 않음 배지에만 국한. omnis 액센트는 브랜드 컬러 하나로 고정(예: 채널별 색은 아이콘/도트에만, 배경엔 안 씀). Effort: S. Risk: 없음 — 순수 토큰 설계.

**타이포는 Inter + Pretendard 페어링, 시스템 폰트 폴백 체인.** `font-family: Pretendard, Inter, -apple-system, sans-serif` 순으로 지정해 한글은 Pretendard, 라틴은 Inter가 렌더링되게 한다(두 폰트가 서로의 라틴/한글 글립을 억지로 안 쓰게). 웨이트는 Linear식 3단(400/510~500/590~600)으로 제한 — bold 남발 금지. Effort: S. Risk: 없음(둘 다 OFL 라이선스, 번들 크기만 주의 — variable font 서브셋팅 필요).

**커맨드 팔레트는 omnis의 핵심 인터랙션으로 취급하라(Superhuman/Arc/Raycast 공통 패턴).** ⌘K로 모든 채널·에이전트 세션·투두를 넘나드는 단일 진입점을 만들어라 — 이게 "여러 앱을 하나로 통합"이라는 omnis의 핵심 가치제안을 UI로 증명하는 지점이다. shadcn Command(cmdk 래핑) 그대로 쓰고, 액션 등록 방식은 kbar 패턴(id+name+shortcut+perform)을 참고해 에이전트 액션(코덱스에 위임, 헤르메스 호출)도 같은 팔레트 안에 넣는다. Effort: M. Risk: 낮음 — 라이브러리 성숙도 높음.

**가상 리스트는 처음부터 깔아라, 나중에 붙이면 리스트 컴포넌트 전체 재작성이 된다.** 10만 메시지 규모를 명시했으므로 react-virtuoso(그룹/가변높이 내장)를 인박스 리스트 컴포넌트의 기초로 못 박는다. Effort: M. Risk: 낮음(단, 각 행에 이미지/아바타 지연로딩 안 하면 스크롤 버벅임 — 별도 이슈).

**Notion Mail 종료 사례는 제품 포지셔닝 경고로 반영하라.** "이메일 UI 자체를 잘 만드는 것"보다 "에이전트가 먼저 처리하고 사람은 예외 상황만 본다"가 시장이 검증한 방향이다. omnis의 강점은 이미 이 방향(agent-managed todo, draft reply)이므로 UI 설계 시 "받은편지함을 안 열어도 되는" 경로(알림 → 초안 확인 → 원클릭 발송)를 1급 시민으로 다뤄야 한다. Effort: 기획 영향(코드 아님). Risk: 중 — 표본이 하나(Notion)뿐이라 과대해석 주의, UNVERIFIED로 남는 인과관계는 "AI 에이전트가 이메일 UI를 대체한다"는 Notion 측 공식 설명 자체.

## 5. What to borrow

- **Superhuman의 커맨드 모달 타이포**(모노스페이스 폰트로 액션명 표시, 우측에 단축키 노출) → omnis `CommandPalette.tsx`에서 각 액션 항목 우측에 `kbd` 요소로 단축키 렌더링. 참고: [Superhuman 블로그](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)
- **Arc의 사이드바=1급 네비게이션** 구조(탭바/북마크바를 없애고 사이드바+커맨드바 두 개로 전체 내비게이션을 흡수) → omnis 좌측 사이드바에 채널 필터 + Network + 에이전트 세션 리스트를 한 컬럼에 통합, 상단 검색바는 별도 요소 없이 ⌘K로 흡수.
- **Things 3/Craft의 밀도 캘리브레이션** → 리스트 행 높이를 44–56px 사이(아바타 24px + 2줄 텍스트) 스타트포인트로 잡고, "compact/comfortable" 밀도 토글은 나중 릴리스로 미뤄도 됨(YAGNI, 유저가 1명이라 설정 불필요할 수도).
- **shadcn MCP 워크플로**: `pnpm dlx shadcn@latest mcp init --client claude` 한 줄로 Claude Code 세션에 컴포넌트 설치 능력을 부여 — 디자인-투-코드 루프를 개발 초기부터 세팅. 참고: [ui.shadcn.com/docs/mcp](https://ui.shadcn.com/docs/mcp)
- **frontend-design 스킬 + chrome-devtools/Playwright 시각 QA 루프**: 컴포넌트 작성 후 반드시 스크린샷 기반 리뷰 패스를 분리(작성 세션과 검토 세션을 분리하는 OMC 원칙과 일치). Figma MCP는 아직 이 세션에서 미인증 상태(`plugin:figma:figma` 인증 필요) — Logan이 `claude mcp`/`/mcp`로 인증해야 실사용 가능.
- **Tauri window-vibrancy README의 `NSGlassEffectViewStyle`** 예제 코드를 그대로 참고해 macOS 26 타겟 빌드에서 Liquid Glass 윈도우 이펙트 적용. 참고: [tauri-apps/window-vibrancy](https://github.com/tauri-apps/window-vibrancy)

## 6. 구체 토큰 (시작점)

```
/* spacing (Linear 8px 래더 차용) */
--space-1: 4px;  --space-2: 8px;  --space-3: 12px;
--space-4: 16px; --space-6: 24px; --space-16: 96px;

/* radius */
--radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-full: 999px;

/* type scale (1.2 minor-third, base 14px — 정보 밀도 앱이라 15/16px 본문은 과함) */
--text-xs: 12px; --text-sm: 13px; --text-base: 14px;
--text-lg: 16px; --text-xl: 20px; --text-2xl: 26px;
font-family: Pretendard, Inter, -apple-system, system-ui, sans-serif;
font-weight: 400 (본문) / 510 (강조) / 590 (제목);

/* color (다크 우선, OKLCH) — 팔레트는 Logan 브랜드 컬러로 치환 필요 */
--bg-base: oklch(0.14 0.005 260);   /* 근흑 */
--bg-elevated: oklch(0.19 0.006 260);
--border-hairline: oklch(1 0 0 / 0.08);
--accent: <브랜드 1색>;

/* motion (Linear 기준) */
--dur-fast: 100ms; --dur-base: 160ms; --dur-slow: 400ms;
--ease-spring: cubic-bezier(0.2, 0, 0, 1);
```

## 7. Open questions

- Figma MCP가 이 세션에서 미인증 — Logan이 인증한 뒤 kinso.ai/Superhuman 실제 화면을 Figma로 옮겨 토큰을 정밀 추출할지 결정 필요.
- shadcn `--base Radix vs Base UI` 선택은 2026-07 기본값 전환(Base UI)이 최근이라 생태계 성숙도가 낮을 수 있음 — 프로젝트 착수 시점에 재확인 필요.
- Tauri `window-vibrancy`의 실제 macOS 26 Liquid Glass API(`apply_liquid_glass`, `NSGlassEffectViewStyle`) 성숙도가 "2026-09 진행 중" 수준으로 불안정할 수 있음 — PoC 단계에서 폴백(CSS blur)까지 같이 구현해 리스크 헤지 필요.
- Notion Mail 종료가 "에이전트가 인박스 UI를 대체한다"는 하나의 사례일 뿐 — omnis가 반대로 "사람이 볼 UI"를 잘 만드는 데 투자할 가치가 있는지는 별도 검증(유저 조사) 필요.
- 사운드/햅틱: 브리프에서 요구했으나 이번 리서치에서 사운드 디자인 레퍼런스(예: macOS 시스템 사운드 정책)는 다루지 못함 — 별도 리서치 필요.

## 8. Sources

- [Apple Newsroom — Apple introduces a delightful and elegant new software design](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) (2026-09-20)
- [WWDC25 #323 — Build a SwiftUI app with the new design](https://developer.apple.com/videos/play/wwdc2025/323/) (2026-09-20)
- [WWDC25 #310 — Build an AppKit app with the new design](https://developer.apple.com/videos/play/wwdc2025/310/) (2026-09-20)
- [WWDC25 #356 — Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/) (2026-09-20)
- [Superhuman Blog — How to build a remarkable command palette](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/) (2026-09-20)
- [Superhuman Help Center — Speed Up With Shortcuts](https://help.superhuman.com/hc/en-us/articles/45191759067411-Speed-Up-With-Shortcuts) (2026-09-20)
- [DesignMD — Linear design tokens](https://www.designmd.co/d/linear.app) (2026-09-20)
- [shadcn.io — Raycast design system](https://www.shadcn.io/design/raycast) (2026-09-20)
- [Blake Crosley — Arc Browser: Reimagining the Browser Chrome](https://blakecrosley.com/guides/design/arc) (2026-09-20)
- [Pratt IXD — Design Critique: Things 3](https://ixd.prattsi.org/2020/02/design-critique-things-3-ios-app/) (2026-09-20)
- [Notion Help Center — Notion Mail inbox is going away](https://www.notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next) (2026-09-20)
- [Kinso.ai](https://www.kinso.ai/) (2026-09-20)
- [thisandthat.chat — Kinso Review 2026](https://www.thisandthat.chat/blog/kinso-review/) (2026-09-20)
- [Pretendard GitHub README](https://github.com/orioncactus/pretendard/blob/main/packages/pretendard/docs/en/README.md) (2026-09-20)
- [Tailwind CSS v4.0 official blog](https://tailwindcss.com/blog/tailwindcss-v4) (2026-09-20)
- [shadcn/ui — Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4) (2026-09-20)
- [shadcn/ui — changelog](https://ui.shadcn.com/docs/changelog) (2026-09-20)
- [shadcn/ui — MCP server docs](https://ui.shadcn.com/docs/mcp) (2026-09-20)
- [tauri-apps/window-vibrancy GitHub](https://github.com/tauri-apps/window-vibrancy) (2026-09-20)
- [Eddyter — Lexical vs TipTap 2026](https://eddyter.com/blogs/lexical-vs-tiptap-2026) (2026-09-20)
- [TanStack Virtual official docs](https://tanstack.com/virtual/latest/docs/introduction) (2026-09-20)
