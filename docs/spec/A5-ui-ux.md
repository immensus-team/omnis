# A5 — UI/UX 상세

버전 1.0 (2026-09-20, 전역 리뷰 pass 2 `99-review-v2.md` 반영판. pass 1 `99-review.md`도 누적 반영). 근거: `00-omnis-design.md`(마스터 v1.0, §4.2/§6/§12 확장), `A3-data-schema.md`(§3 `persons.primary_thread_id`), `A4-agent-layer.md`(§3.6 초안 알림 3등급, §14 통합 검색 계약), `BRIEF-2026-09-20.md`, `research/14`(Apple 디자인 언어), `research/23`(kinso 실사 티어다운), `research/01`(kinso·경쟁사), `research/17`(투두·브리핑·Network·노트), `research/22`(agentic-inbox·agent-inbox 소스 리딩), `research/13`(클라이언트 아키텍처·동기화). 마스터 §5 D1~D16, §6 데이터 모델, §11 루프, §14 비용 정책, §16 Phase, §19 Q1~Q12는 확정 전제이며 이 부록은 그 위에서만 상세화한다.

## 이 부록이 확정하는 결정

| # | 결정 |
|---|---|
| A5-D1 | 컬러는 다크 우선 OKLCH 토큰 3계층(primitive → semantic → component), 라이트 모드 전체 정의, 단일 액센트 `--accent` 하나로 고정(마스터 D8 재확인) |
| A5-D2 | 타이포는 `Pretendard Variable, Inter Variable, -apple-system, system-ui, sans-serif` 체인, 웨이트 3단(400/510/590), type scale 6단(12/13/14/16/20/26px) |
| A5-D3 | 스페이싱 8px 래더(4/8/12/16/24/96), radius 4단(6/10/16/999), 보더는 그림자 대신 1px 헤어라인(`8% opacity`) |
| A5-D4 | 모션은 100/160/400ms 3단 duration + spring easing 하나, `prefers-reduced-motion`에서 전부 0으로 폴백 |
| A5-D5 | Liquid Glass는 sidebar·toolbar·sheet·command palette에만, 리스트 행과 본문·에디터는 항상 불투명. `window-vibrancy` 우선, CSS `backdrop-filter`는 Linux/Windows 폴백에만 |
| A5-D6 | 아이콘은 Lucide 단일 세트(2px stroke), 채널 브랜드 아이콘은 리스트 행·사이드바에서 항상 우측 고정 슬롯 |
| A5-D7 | 내비게이션은 좌측 사이드바(필터 pill + 8개 섹션) + 3-pane(sidebar/list/detail) 고정 레이아웃, 별도 탭바 없음 |
| A5-D8 | ⌘K는 전역 커맨드 팔레트로 네비게이션·triage·에이전트 액션·검색을 전부 흡수. 키맵은 j/k/e/r/a/s/d/l/t/n/⌘K/⌘Enter/Esc + go-to 접두(`g` then letter) |
| A5-D9 | Draft는 별도 화면이 아니라 카드 컴포넌트(`DraftCard`) + "Edit & send" 게이트. 전문(full text)은 항상 노출, 요약본으로 대체하지 않음 |
| A5-D10 | 비가역 액션(send/delete/delegate/calendar_write)은 `ApprovalSheet` 하나로 통일, `HumanInterrupt`의 4-way config(accept/edit/respond/ignore)로 액션별 허용 버튼을 결정 |
| A5-D11 | Agent Session은 Thread 뷰의 변형이며 tool 호출마다 `TOOL_LABELS` 매핑으로 라벨+아이콘+진행 상태 배지를 렌더링 |
| A5-D12 | 리스트 행: 아바타 + 이름(bold) + 타임스탬프(같은 줄 우측) + 프리뷰 1줄 + 우측 채널 아이콘. 선택 행은 elevation(soft shadow) 카드로, 안읽음은 점선(dashed) 원형 인디케이터로 표시(hairline 구분선 없음) |
| A5-D13 | iPhone은 Phase B installed PWA, 레이아웃은 단일 컬럼 + 하단 탭바(5), 스와이프 좌/우 액션 고정 |
| A5-D14 | 컴포넌트는 shadcn/ui 프리미티브(Radix 베이스) + react-virtuoso(리스트) + Tiptap(에디터) + cmdk/shadcn Command(팔레트) 위에, omnis 전용 9개 커스텀 컴포넌트로 조립 |
| A5-D15 | Tauri 셸은 사이드바 vibrancy, 메뉴바 트레이 상주, 전역 단축키, `omnis://` 딥링크를 1급으로 지원 |
| A5-D16 | 사운드는 macOS 시스템 사운드만 최소 사용(커스텀 오디오 브랜딩 없음), 햅틱은 iPhone PWA의 Vibration API로 승인/스와이프에만 |

---

## 1. 디자인 언어와 토큰

### 1.1 컬러

3계층: **primitive**(원색 스케일) → **semantic**(역할 이름, 다크/라이트 각각 재정의) → **component**(개별 컴포넌트가 semantic만 참조). 컴포넌트 CSS는 절대 primitive를 직접 참조하지 않는다 — 이 규칙 자체가 코드 리뷰 체크 항목이다(§9).

Linear(`#08090a`+라임)와 Raycast(`#07080a`+코럴)가 공통 증명한 "근흑 캔버스 + 단일 액센트 + 헤어라인 보더" 패턴을 채택한다(`14`). kinso의 듀얼 그라디언트 액센트(틸↔오렌지, `23`)는 마스터 D8이 이미 "단일 액센트"로 확정했으므로 채택하지 않는다 — 재논의 대상 아님.

```css
:root {
  /* primitive (다크 기본값) */
  --gray-950: oklch(0.14 0.005 260);
  --gray-900: oklch(0.17 0.006 260);
  --gray-850: oklch(0.19 0.006 260);
  --gray-700: oklch(0.32 0.006 260);
  --gray-500: oklch(0.55 0.006 260);
  --gray-300: oklch(0.78 0.004 260);
  --gray-100: oklch(0.94 0.002 260);
  --gray-000: oklch(0.99 0.001 260);

  /* 단일 액센트 — 기본값. Logan이 브랜드 컬러를 확정하면 이 한 줄만 교체 */
  --accent-500: oklch(0.70 0.15 230); /* cool cyan-blue, Linear 라임/Raycast 코럴과 겹치지 않는 톤 */
  --accent-600: oklch(0.62 0.16 230);
  --danger-500: oklch(0.62 0.19 25);
  --warn-500: oklch(0.75 0.15 80);
  --success-500: oklch(0.68 0.14 150);

  /* semantic — 다크 */
  --bg-base: var(--gray-950);
  --bg-elevated: var(--gray-850);
  --bg-overlay: color-mix(in oklch, var(--gray-900) 72%, transparent); /* glass 표면 전용, §1.4 */
  --border-hairline: oklch(1 0 0 / 0.08);
  --border-hairline-strong: oklch(1 0 0 / 0.14);
  --text-primary: var(--gray-100);
  --text-secondary: var(--gray-500);
  --text-tertiary: oklch(0.55 0.006 260 / 0.7);
  --accent: var(--accent-500);
  --accent-fg: oklch(0.14 0 0);
  --shadow-row-selected: 0 4px 16px oklch(0 0 0 / 0.35), 0 1px 2px oklch(0 0 0 / 0.4);
}

:root[data-theme="light"] {
  --bg-base: var(--gray-000);
  --bg-elevated: oklch(0.97 0.002 260);
  --bg-overlay: color-mix(in oklch, var(--gray-000) 78%, transparent);
  --border-hairline: oklch(0 0 0 / 0.08);
  --border-hairline-strong: oklch(0 0 0 / 0.14);
  --text-primary: oklch(0.20 0.006 260);
  --text-secondary: oklch(0.42 0.006 260);
  --text-tertiary: oklch(0.55 0.006 260 / 0.75);
  --accent: var(--accent-600);
  --accent-fg: oklch(0.99 0 0);
  --shadow-row-selected: 0 4px 16px oklch(0 0 0 / 0.10), 0 1px 2px oklch(0 0 0 / 0.08);
}
```

기본은 다크(`data-theme` 속성 없음 = 다크). 라이트는 `data-theme="light"` 명시. macOS는 `prefers-color-scheme`를 초기값으로 읽되 Settings에서 수동 override 가능(자동/다크/라이트 3-way, 이 부분이 유일한 사용자 노출 컬러 설정).

**채널 정체성은 색이 아니라 아이콘으로 표현한다**(kinso 실측, `23`): 리스트 행 배경색·아바타 색조는 채널마다 절대 바꾸지 않는다. 오직 우측 고정 슬롯의 브랜드 컬러 아이콘(Slack 보라, Gmail 빨강, WhatsApp 초록 등 각 채널 공식 마크)만 색을 낸다. 이 규칙 위반(행 배경에 채널색 틴트)은 §9 QA 체크리스트 실패 항목이다.

### 1.2 타이포그래피

```css
:root {
  --font-sans: "Pretendard Variable", "Inter Variable", -apple-system,
    BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  --font-mono: "SF Mono", "JetBrains Mono", ui-monospace, monospace; /* 팔레트 단축키·코드 블록 전용 */

  --text-xs: 12px;   --leading-xs: 16px;
  --text-sm: 13px;   --leading-sm: 18px;
  --text-base: 14px; --leading-base: 20px;
  --text-lg: 16px;   --leading-lg: 24px;
  --text-xl: 20px;   --leading-xl: 26px;
  --text-2xl: 26px;  --leading-2xl: 32px;

  --weight-regular: 400;
  --weight-medium: 510;
  --weight-semibold: 590;
}
```

Pretendard(한글) + Inter(라틴) 체인은 두 폰트가 서로의 문자셋을 침범하지 않고 각자 자기 언어만 렌더링하게 하는 표준 관행이다(`14`). 볼드(700+)는 쓰지 않는다 — 590(semibold)이 최고 강조 웨이트. 본문 기본 크기는 14px(정보 밀도 우선, Things 3/Craft의 "너무 성기지도 빽빽하지도 않게" 밀도 캘리브레이션을 인박스형 앱에 맞게 한 단계 조밀하게 당긴 값, `14` §5). Pretendard는 npm `pretendard` 패키지의 variable font를 서브셋 없이 번들(한글 전체 글립 필요), Inter는 `inter` 패키지에서 라틴만 서브셋.

### 1.3 스페이싱·라운드·헤어라인

```css
:root {
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-16: 96px;

  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-full: 999px;

  --hairline: 1px solid var(--border-hairline);
  --hairline-strong: 1px solid var(--border-hairline-strong);
}
```

카드 경계는 그림자가 아니라 헤어라인으로 표현한다(Linear/Raycast 패턴). 예외는 딱 하나 — **선택된 리스트 행**만 `--shadow-row-selected`로 뜬다(kinso 패턴, `23`). 그 외 모든 곳에서 box-shadow는 금지(팝오버/드롭다운 자체 부양 제외).

### 1.4 모션

```css
:root {
  --dur-fast: 100ms;
  --dur-base: 160ms;
  --dur-slow: 400ms;
  --ease-spring: cubic-bezier(0.2, 0, 0, 1);
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; }
}
```

규칙: **100ms** = hover/press 피드백(버튼, 리스트 행 hover), **160ms** = 상태 전환(패널 열기/닫기, 탭 전환, 배지 등장), **400ms** = 레이아웃 재배치(리스트에서 행 제거 후 collapse, 사이드바 열기/닫기). 스프링은 `--ease-spring` 하나로 통일 — 여러 이징 곡선을 섞지 않는다(일관성이 "AI가 만든 UI"와의 차이, §9). `prefers-reduced-motion`은 duration을 0으로만 낮추고 애니메이션 자체(opacity/transform)는 유지해 상태 변화가 갑자기 끊기지 않게 한다.

### 1.5 Liquid Glass 사용 규칙 (코드 규칙)

Apple 공식 원칙(`14`): 유리는 **컨트롤/내비게이션** 레이어(사이드바, 툴바, 시트, 팝오버, 커맨드 팔레트)에만 쓰고 **콘텐츠**(리스트, 본문, 스크롤 영역)에는 쓰지 않는다. 이걸 CSS 클래스 레벨의 강제 규칙으로 못 박는다:

```css
/* 허용: --glass-* 클래스는 이 4개 컴포넌트에서만 import 가능 (lint 규칙, §9) */
.glass-surface {
  background: var(--bg-overlay);
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  border: var(--hairline);
}
/* Sidebar, Toolbar, Sheet(ApprovalSheet/설정 모달), CommandPalette 컨테이너에만 적용 */

/* 금지: 리스트 행, ThreadView 본문, DraftCard 본문, Tiptap 에디터 — 항상 불투명 */
.opaque-surface { background: var(--bg-base); }
```

macOS Tauri 셸에서는 `window-vibrancy`의 `apply_liquid_glass`(macOS 26 Tahoe, `NSGlassEffectViewStyle`)를 사이드바 윈도우 레이어에 직접 적용하고, `.glass-surface`의 `backdrop-filter`는 vibrancy가 실패하는 플랫폼(Linux/Windows Tauri 빌드, 향후 확장 시)의 CSS 폴백으로만 남긴다(`14` 옵션 비교). `window-vibrancy` 최신 API가 "2026-09 진행 중"으로 불안정할 수 있다는 리서치 경고가 있으므로(`14` §7), PoC 단계에서 vibrancy 실패 시 자동으로 `.glass-surface` CSS 폴백으로 다운그레이드하는 feature-detect를 넣는다(`window.__TAURI__.vibrancy.supported` 체크, 실패 시 `data-vibrancy="css-fallback"` 속성을 `<html>`에 세팅해 CSS가 분기).

### 1.6 아이콘

Lucide 단일 세트, 2px stroke, 16/20px 두 사이즈만 사용(그 외 커스텀 사이즈 금지). Lucide는 SF Symbols와 형태 문법이 가장 가깝고 shadcn 기본 채택 세트라 마찰이 없다(`14`). 채널 브랜드 아이콘(Slack/Gmail/Outlook/Calendar/Telegram/WhatsApp/KakaoTalk/LinkedIn)과 에이전트 런타임 아이콘(Claude Code/Codex/DeepSeek/Hermes/omnis)은 각 공식 마크의 SVG를 24×24 viewBox로 정규화해 `packages/ui/icons/channels/*.svg`, `packages/ui/icons/runtimes/*.svg`에 보관하고, 리스트 행·사이드바·설정에서 **항상 우측 또는 지정된 고정 슬롯**에만 쓴다(좌측 아바타 슬롯과 절대 혼용하지 않음 — A5-D6, D12).

### 1.7 사운드·햅틱

사운드 디자인은 이번 리서치 범위에 없었다(`14` §7 오픈퀘스천). 기본값: **커스텀 사운드를 만들지 않는다.** macOS 앱은 승인 대기 알림에만 시스템 사운드(`NSSound(named: "Glass")`, 볼륨 시스템 설정 따름)를 재생하고 기본은 무음(설정에서 on). 그 외 모든 인터랙션(전송, 보관, 완료)은 무음 — 사운드 남발은 프로덕티비티 앱에서 방해 요소라는 통념을 따른다. 이 기본값을 바꿀 조건: Logan이 사용 중 "피드백이 부족하다"고 느끼면 전송 완료 1개 사운드만 추가 검토.

햅틱은 iPhone PWA의 Web Vibration API(`navigator.vibrate()`)로, 승인 스와이프 완료 시 짧은 펄스(10ms) 1회만 — iOS Safari의 Vibration API 지원이 제한적이므로(무음 모드 무관하게 동작 안 할 수 있음) 시각 피드백(체크 애니메이션)을 항상 병행하고 햅틱은 보강재로만 취급한다.

---

## 2. 정보 구조와 내비게이션

### 2.1 사이드바

Arc 브라우저의 "사이드바 = 1급 내비게이션" 패턴(`14`)을 채택 — 별도 탭바나 상단 네비 바 없이 좌측 사이드바 하나가 전체 내비게이션을 흡수한다.

```
┌ Sidebar (glass) ──────────┐
│ ⌘K  Search / Ask omnis    │  ← 팔레트 진입점(pill 버튼)
│                            │
│ Inbox                      │
│  ○ All            128      │  ← 필터 pill (5개, 가로 스크롤 or 줄바꿈)
│  ○ Work            84      │
│  ○ Personal         31      │
│  ○ Agents           9       │
│  ● Needs approval    4      │  ← 선택 상태 = elevation
│                            │
│ ─────────────────         │
│ 🗓 Today                   │
│ ✓ Tasks              12    │
│ 👤 Network                 │
│ 📝 Notes                   │
│ 🌙 Digest                  │
│                            │
│ ─── Agent sessions ───    │
│  Claude Code · kernel      │  ← 활성 세션 리스트(살아있는 것만)
│  Codex · adapter-slack     │
│                            │
│ ⚙ Settings                 │
└────────────────────────────┘
```

필터 pill 5개(All/Work/Personal/Agents/Needs approval)는 `items.status`와 `labels.kind='scope'`(work/personal) 조합의 뷰이며 서로 배타적(라디오, 마스터 §12 UI 문법과 일치). "Needs approval"은 `pending_approvals.state='pending'`이 있는 스레드만 필터링 — 배지 숫자는 항상 실시간(NOTIFY 구독).

### 2.2 3-pane 레이아웃

```
┌──────────┬───────────────────┬─────────────────────────┐
│ Sidebar  │  List pane         │  Detail pane              │
│ (240px,  │  (360–420px,       │  (flex, min 480px)        │
│  glass)  │  opaque)           │  (opaque)                 │
│          │                    │                            │
│  nav     │  InboxRow × N      │  ThreadView 또는           │
│  filters │  (react-virtuoso)  │  AgentSession 또는         │
│          │                    │  DraftCard 편집 모드 등    │
└──────────┴───────────────────┴─────────────────────────┘
```

리스트 pane과 detail pane은 항상 함께 보인다(Today/Network/Notes/Digest/Settings는 list pane 대신 자기 레이아웃을 detail 영역 전체에 편다 — pane 3개 구조 자체는 유지하되 list pane 폭을 0으로 접는 화면도 있음, §3에서 화면별로 명시). 사이드바는 `⌘\`로 토글 접힘 가능(맥 표준 관행), list pane은 최소 320px 아래로 줄어들지 않음(가변 폭 리사이즈 핸들 제공).

### 2.3 ⌘K 커맨드 팔레트

shadcn Command(cmdk 래핑) 기반, kbar 패턴(`id + name + shortcut + perform`, `14`)으로 액션을 등록한다. 팔레트는 모달로 화면 중앙에 뜨고, Superhuman 스타일로 각 액션 우측에 단축키를 `<kbd>`로 노출한다(`14` §5).

액션 카테고리(그룹 헤더로 구분):

1. **이동(Navigation)**: Go to Inbox / Today / Tasks / Network / Notes / Digest / Settings, Go to thread…(퍼지 검색)
2. **Triage**: Archive, Snooze, Mark as Work/Personal, Add label…, Mark read/unread, Delete
3. **Draft & Reply**: Reply, Reply all, Edit draft, Regenerate draft, Discard draft, Send(⌘Enter)
4. **Agent actions**: Ask agent about this thread, Summarize thread, Delegate to Codex…, Delegate to Hermes…, Delegate to claude-ds…, Add task from this, Add note, Route note to…
5. **Approval**: Approve, Reject, Edit & approve(대기 중인 pending_approval이 있을 때만 노출)
6. **검색**: 사람/스레드/투두/노트 전체 검색(universal search, 마스터 §3)
7. **설정/시스템**: Toggle theme, Toggle autonomy for this thread, Open kill switch, Sign out

에이전트 액션은 `propose_delegation` 결과가 아니라 **사람이 먼저 요청**하는 액션이라 tool palette 격리(마스터 §11)와 충돌하지 않는다 — 팔레트에서 "Delegate to Codex"를 고르면 `pending_approvals(action='delegate')`가 생성되고 `ApprovalSheet`로 이어진다(자동 실행 아님).

### 2.4 키맵 (전체)

| 키 | 동작 | 스코프 |
|---|---|---|
| `j` / `k` | 다음/이전 행 선택 | List pane |
| `Enter` / `o` | 선택 행 열기 | List pane |
| `e` | 보관(archive) | List pane, Thread |
| `r` | 답장(Draft 편집 열기, draft 있으면 그걸 열고 없으면 새로 생성 요청) | Thread |
| `a` | 승인(대기 중인 approval이 있으면 accept, 없으면 no-op) | List pane, Thread, ApprovalSheet |
| `s` | 스누즈(기간 선택 팝오버) | List pane, Thread |
| `d` | 위임(Delegate 팔레트 서브메뉴 열기) | Thread, Agent Session |
| `l` | 라벨 피커 열기 | List pane, Thread |
| `t` | 이 아이템에서 Task 만들기 | List pane, Thread |
| `n` | 새 노트 입력 포커스 | 전역 |
| `x` | 선택(멀티 셀렉트 체크박스 토글) | List pane |
| `Shift+U` | 읽음/안읽음 토글 | List pane, Thread |
| `/` | 검색 포커스(list pane 내부 필터) | List pane |
| `⌘K` | 커맨드 팔레트 열기 | 전역 |
| `⌘Enter` | 현재 열린 Composer/ApprovalSheet에서 전송/승인 확정 | Composer, ApprovalSheet |
| `Esc` | 패널 닫기 / 선택 해제 / 팔레트 닫기 | 전역 |
| `⌘\` | 사이드바 토글 | 전역 |
| `1`–`5` | 필터 pill 전환(All/Work/Personal/Agents/Needs approval) | 전역(Inbox 컨텍스트) |
| `g` `i` | Inbox로 이동 | 전역(go-to 접두, 300ms 내 다음 키) |
| `g` `t` | Today로 이동 | 전역 |
| `g` `k` | Tasks로 이동 | 전역 |
| `g` `n` | Network으로 이동 | 전역 |
| `g` `o` | Notes로 이동(o = notes, n은 Network과 충돌) | 전역 |
| `g` `d` | Digest로 이동 | 전역 |
| `g` `s` | Settings로 이동 | 전역 |

Superhuman의 "팔레트 실행 시 해당 단축키를 옆에 노출해 학습시킨다"(`14`) 원칙을 그대로 채택 — 모든 팔레트 액션 행 우측에 위 표의 단축키를 `<kbd>`로 렌더링한다.

### 2.5 통합 검색 — ⌘K 검색 모드 (Phase B)

마스터 §3 "핵심 인터랙션": "⌘K 커맨드 팔레트(에이전트 액션 + 통합 검색: items 전문검색 + memories kNN, Phase B)". §2.3의 카테고리 6("검색")이 여는 것이 이 모드다 — 별도 화면이나 별도 단축키가 아니라, ⌘K 팔레트에 입력 중인 문자열이 등록된 액션 이름과 매치되지 않으면(cmdk의 기본 필터링 동작) 팔레트가 **액션 목록에서 검색 결과 목록으로 전환**된다.

**데이터 소스는 A4 §14 `GET /search` 하나뿐이다**(99-review-v2 §4-5). 클라이언트는 `items.search_tsv`·trigram 인덱스·`search_memory` tool을 직접 호출하지 않는다 — `search_tsv`는 A3 §7에서 Zero 복제 대상에서 제외됐고(`memories`/`entities`도 마찬가지), Postgres 전용 컬럼과 kNN을 클라이언트가 로컬 쿼리로 대신할 수 없기 때문이다. A4 §14가 서버에서 네 갈래 쿼리(items tsvector FTS + `items_body_trgm_idx` 폴백 / threads 집계 / persons `persons_name_trgm_idx` / memories kNN, 인덱스명은 A3 §7·§12 DDL 그대로)를 병렬 실행하고 그룹 내 정규화 + 그룹 가중치 병합 랭킹까지 끝낸 `SearchResponse`를 돌려준다 — A5는 그 응답을 그대로 렌더링만 한다.

```ts
GET /search?q=<string>&k=<int>&scope=<work|personal|all>&since=<iso8601>  // A4 §14.1, 허브 127.0.0.1:8787, Tailscale Serve로 맥·아이폰 공통 경로
```

**결과 그룹**(A4 §14.4 `SearchResponse.groups` — 순서 고정 `people → threads → items → memories`, 그룹당 최대 5개 + `total`이 5를 넘는 그룹만 "N개 더 보기"로 `truncated`):
1. **사람(People)** — `SearchHit.kind='person'`. 선택 시 `deep_link.person_id`로 Network의 해당 PersonCard 상세.
2. **스레드(Threads)** — `kind='thread'`. 선택 시 `deep_link.thread_id`로 해당 Thread.
3. **아이템(Items)** — `kind='item'`. `snippet`(≤160자, A4 `ts_headline` 또는 절단)을 그대로 보여주고, 선택 시 `deep_link.item_id`로 스크롤된 Thread.
4. **메모리(Memories)** — `kind='memory'`. `snippet` + `source_kind`(inbox/calendar/file/drive/github/self) 배지, `deep_link`가 있으면 그 Item/스레드로, `null`이면(출처 Item 없는 memory — self-model 등) 스니펫만 보여주고 클릭 비활성.

각 행은 `SearchHit`의 `title`/`snippet`/`at`/`channel`을 그대로 렌더링한다(A4 §14.4 스키마, A5에서 추가 가공 없음).

**키보드 내비게이션**: 팔레트 자체의 표준 동작을 그대로 쓴다 — `↑`/`↓`로 그룹을 넘나들며 결과 사이 이동(포커스가 그룹 경계에서 다음 그룹 첫 항목으로 자연스럽게 넘어감), `Enter`로 선택 항목 열기, `Esc`로 팔레트 닫기(액션 목록으로 되돌아가려면 입력을 지우면 됨 — 별도 "뒤로" 키 없음). `j`/`k`는 여기서 쓰지 않는다(팔레트 안은 cmdk의 방향키 규약을 따름, List pane의 `j`/`k`와 컨텍스트가 다름).

**빈 상태**: "{query}에 대한 검색 결과가 없어요" — 그룹 헤더 없이 팔레트 중앙에 한 번만(`SearchResponse.groups`가 전부 빈 경우).

**로딩/느림 상태**: 네 쿼리는 서버에서 병렬로 돌지만(A4 §14.2) 응답은 `SearchResponse` 하나로 한 번에 온다 — items/threads/people/memories를 그룹별로 스트리밍하지 않는다. `took_ms`가 아래 목표치를 넘기면 팔레트 하단에 스피너를 유지하고 이전 쿼리 결과(있으면)는 남겨둔 채 새 결과로 교체한다.

**지연·디바운스 목표**(A4 §14.5, **S-A4-7 — UNVERIFIED**, `research/`에 근거 없음, `memories` 1만 row에서 재고 확정): 입력 후 **180ms** 디바운스, p95 목표는 items/threads/people **≤ 400ms**, memories(임베딩 포함) **≤ 1.2s**. 미달 시 A4가 그룹별 상한을 5 → 3으로 낮춘다(A5는 그 상한을 그대로 렌더링하면 되고 클라이언트 로직 변경은 없다).

---

## 3. 화면별 명세

공통 표기: **데이터 바인딩**은 Zero 클라이언트 쿼리를 의사코드로 표기한다(정확한 Zero 쿼리 빌더 문법은 A3/구현 스파이크에서 Zero 공식 문서 기준으로 확정 — 여기서는 어떤 테이블·필드가 화면에 소비되는지만 명시). 테이블 이름은 마스터 §6 데이터 모델을 그대로 따른다.

### 3.1 Inbox

**목적**: 8채널 + 에이전트 세션을 하나의 스트림에서 triage. omnis의 핵심 가치제안이 증명되는 화면.

```
┌ Sidebar ┬──────────────────────────┬───────────────────────────┐
│ All  Work Personal Agents Needs△(4)│  ThreadView / DraftCard     │
├──────────┼──────────────────────────┼───────────────────────────┤
│          │ ⬤ Sora Kim      · 09:14 │                            │
│          │   "회의 자료 확인 부탁..." [G]│  (선택 행의 상세)          │
│          │ ○ Codex · adapter-slack ·10│                            │
│          │   "adapter 테스트 3개 실패"[◆]│                            │
│          │ ⬤ David Park    · 어제   │                            │
│          │   "월요일 미팅 가능하신..."[S]│                            │
└──────────┴──────────────────────────┴───────────────────────────┘
[G]=Gmail [S]=Slack [◆]=Agent  ⬤=선택가능 ○=선택됨(카드+shadow)
```

**구성요소**: `InboxRow`(×N, react-virtuoso), 필터 pill 바(sidebar에 위치, §2.1), 다중 선택 시 상단에 bulk action bar(Archive/Label/Delegate 등장).

**InboxRow 명세**(kinso 실측 `23` + agentic-inbox 톤 배지 `22` 결합):
- 좌: 아바타(원형 32px, 사람) 또는 런타임 아이콘(agent_session일 때 squircle 32px)
- 중: 1행 = 이름/제목(590 weight) + 타임스탬프(우측, `--text-secondary`, `--text-xs`), 2행 좌측 = 본문 프리뷰(`--text-secondary`, ellipsis, 라벨 칩 폭만큼 우측을 남기고 잘림) 또는 status가 `draft`일 때 "초안: {본문 앞부분}"을 `--accent`로, 2행 우측 = **라벨 칩**(아래 명세)
- 우: 채널/런타임 브랜드 아이콘(고정 20px 슬롯, A5-D6), 그 위에 안읽음이면 점선 원형 인디케이터(`23`의 dashed circle을 그대로 채택 — solid dot 대신 differentiator)
- 선택 상태: 배경 `--bg-elevated` + `--shadow-row-selected`로 카드 분리, hairline 구분선은 안 씀(kinso 패턴). 비선택 행은 `--bg-base` 위에 `--space-3` 세로 패딩만으로 밀도 관리
- `pending_approvals`가 있는 스레드는 행 우측 끝에 작은 앰버 dot 배지 추가(brand icon과 겹치지 않게 아이콘 좌상단 오버레이)

**라벨 칩 명세(마스터 §3 "라벨은 InboxRow 2행 우측에 칩 2개 + `+N`", 99-review §4 항목12 반영)**: 스레드에 붙은 `thread_labels`(마스터 §6, A3 `labels.kind IN ('scope','topic','priority','person')`) 중 최대 2개를 2행 우측에 칩으로 노출하고 나머지는 `+N` 하나로 접는다.
- **선택 우선순위**: ① `kind='scope'` 칩(work/personal)이 있으면 항상 1번째 — 스레드 성격을 가장 먼저 알려준다. ② 나머지 한 자리는 `topic`/`person`/`priority` 라벨 중 `item_labels.confidence`(또는 `thread_labels.confidence`)가 가장 높은 것 1개. ③ 그 외 라벨은 개수만 `+N`(N = 전체 라벨 수 − 2)로 표시, 클릭 시 팝오버로 전체 목록.
- **색**: 칩 배경은 `labels.color`(A3 `labels` 테이블 컬럼)가 있으면 그 값을 `--bg-elevated` 위에 12% 불투명도로 올려 텍스트만 해당 색조로 강조하고, `color`가 없으면 중립 `--gray-700`/`--text-secondary` 칩으로 폴백한다. **채널 브랜드 색(Slack 보라·Gmail 빨강 등)은 라벨 칩에 절대 쓰지 않는다** — 우측 채널 아이콘 슬롯과 색 문법을 공유하면 "이 라벨이 이 채널 전용"이라는 오해를 만들기 때문(§1.1 채널 정체성 규칙과 동일한 근거).
- **트렁케이션**: 칩 텍스트는 `--text-xs`, 최대 폭 96px(`--space-16`)에서 ellipsis, 칩 자체는 `--radius-full`(pill — 검색/커맨드 입력과 함께 pill이 허용되는 예외 케이스, §9 QA 체크리스트의 "pill 남용 금지"는 버튼/입력에 대한 것이고 상태 칩은 대상 밖). `+N`은 별도 칩이 아니라 마지막 칩 옆의 `--text-tertiary` 텍스트.
- **접근성**: 각 칩은 `aria-label="{kind} 라벨: {name}"`, `+N`은 `aria-label="라벨 {N}개 더 보기"`.

**상태**:
- 로딩: skeleton row 8개(react-virtuoso `placeholderComponent`), 아바타/텍스트 자리만 `--bg-elevated` 펄스
- 빈: "받은 편지함이 비어 있습니다" + "연결된 채널: 8개 정상" 서브텍스트(§8 마이크로카피)
- 오류: 특정 채널 어댑터 실패 시 리스트 상단에 인라인 배너("Slack 연결이 끊겼어요 — 재연결"), 리스트 자체는 나머지 채널 데이터로 계속 렌더링(부분 실패가 전체를 막지 않음)
- 오프라인: 상단 고정 배너("오프라인 — 마지막 동기화 3분 전"), 캐시된 Zero 로컬 데이터로 계속 조작 가능하되 새 액션(승인/전송)은 큐잉 후 재연결 시 flush

**데이터 바인딩**(의사코드):
```ts
// items ⋈ threads, 선택된 필터 pill에 따라 where 절만 바뀜
zero.query('items')
  .where('thread.archived_at', 'IS', null)
  .where(filter === 'work' ? ['thread.labels', 'CONTAINS', 'scope:work'] : undefined)
  .where(filter === 'needs-approval' ? ['thread.pending_approvals.state', '=', 'pending'] : undefined)
  .orderBy('sent_at', 'desc')
  .related('thread', t => t.related('participants'))
  .related('author')
  .limit(50) // react-virtuoso가 스크롤 근접 시 다음 페이지 요청
```

**인터랙션**: `j/k` 이동, `Enter`로 열기(우측 pane에 ThreadView/AgentSession 렌더링), `e/r/a/s/l/t` 단일 행 즉시 액션(마우스 hover 시 우측에 아이콘 버튼도 노출), `x`로 멀티 선택 후 bulk archive/label.

**접근성**: 리스트는 `role="listbox"`, 행은 `role="option"` + `aria-selected`, 채널 아이콘은 `aria-label="Slack 메시지"`(장식 아이콘 아님, 정보 전달), 점선 unread 인디케이터는 `aria-label="안읽음"` 별도 텍스트 동반(색/모양만으로 전달 금지). 키보드 포커스 링은 `--accent` 2px outline, `outline-offset: -1px`.

### 3.2 Thread

**목적**: 사람 간 대화(DM/그룹/이메일)의 전체 맥락 + 컨텍스트 기반 draft 확인.

```
┌ Thread header (glass toolbar) ──────────────────────┐
│ ← Sora Kim (Slack)              [Archive][Label][⋯] │
├───────────────────────────────────────────────────────┤
│  09:02  Sora: 회의 자료 초안 공유드려요                │
│  09:14  Sora: 확인 부탁드립니다!                        │
│                                                          │
│ ┌ DraftCard ────────────────────────────────────────┐ │
│ │ omnis 초안 · 근거: PROJECTS.md #davich, 지난 스레드 2건 │ │
│ │ "네 확인했습니다, 내일 오전에 코멘트 드릴게요..."      │ │
│ │            [Edit & send]  [Discard]  [Regenerate]  │ │
│ └───────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

**구성요소**: `ThreadHeader`(참여자, 채널, 액션 버튼), 메시지 리스트(react-virtuoso, 상향 스크롤 시 페이지네이션), `DraftCard`(status가 `draft`인 Item이 있을 때만), `Composer`(직접 타이핑 답장, Tiptap).

**DraftCard 명세(A5-D9, agentic-inbox 이식 `22`)**: 초안은 항상 **전문 노출**(요약 금지 — 승인 전 판단에 요약은 부적합). 카드 상단에 근거(어떤 메모리/과거 스레드를 참조했는지 1줄, `memories.source_item_id` 역참조) 표기. 버튼 3개: **Edit & send**(Composer가 draft 내용으로 열리고 사람이 고쳐도 되고 그대로 눌러도 됨 → 명시적 Send 버튼을 눌러야 실제 `pending_approvals(action='send')` 생성 → 승인되면 발송, agentic-inbox의 "draft row 생성 → Edit & send 버튼 → 사람 편집(optional) → 명시적 Send → sent row" 상태 머신을 그대로 이식), **Discard**(draft item을 `archived`로), **Regenerate**(같은 컨텍스트로 재생성 요청, 새 draft가 기존 걸 대체).

**상태**: 로딩(메시지 skeleton 3줄), 빈(새 스레드 — "메시지가 없습니다", Composer만 활성), 오류(draft 생성 실패 시 카드 자리에 "초안 생성 실패 — 다시 시도" + 재시도 버튼, 조용히 사라지지 않음), 오프라인(Composer는 로컬 저장 후 재연결 시 전송 큐), 자동 보관됨(`threads.archived_at`이 7일 이내면 헤더 아래 "자동 보관됨 · {N}일 전 — 되살리기" 배너, §3.8 참조 — Digest와 동일한 undo 동작).

**데이터 바인딩**:
```ts
zero.query('items').where('thread_id', '=', threadId).orderBy('sent_at', 'asc').related('author')
zero.query('items').where('thread_id', '=', threadId).where('status', '=', 'draft') // DraftCard
zero.query('pending_approvals').where('payload.item_id', '=', draftItemId) // 승인 상태 확인
```

**인터랙션**: `r`로 Draft 편집 열기(없으면 즉시 `propose_draft` 요청 후 로딩 상태로 카드 자리 예약), `⌘Enter`로 Composer에서 전송(=승인 확정), 채널이 읽기전용(예: LinkedIn write 미승인 상태)이면 Composer 자체가 "이 채널은 승인 후 발신" 안내로 비활성.

**접근성**: 메시지 리스트는 `role="log"`(실시간 추가 콘텐츠), 새 메시지 도착 시 스크린리더에 `aria-live="polite"`로만 알림(매 메시지마다 assertive로 끊지 않음). DraftCard 버튼은 명확한 텍스트 레이블(아이콘 전용 금지).

### 3.3 Agent Session

**목적**: Claude Code/Codex/claude-ds/Hermes/omnis 에이전트 세션을 Thread와 동일한 문법으로 보여주되, tool 호출을 사람이 읽을 수 있게.

```
┌ Agent Session header ────────────────────────────────┐
│ ← Codex · adapter-slack (macbook)      [Read session] │
├─────────────────────────────────────────────────────────┤
│ Turn 1 (agent):  "Slack 어댑터 테스트 3개 실패 확인,     │
│                    원인 조사 중"                          │
│  ⚙ 읽는 중 · adapter/slack/*.test.ts        ✓ 완료       │
│  ⚙ 메모리 검색 중 · "slack rate limit"       ✓ 완료       │
│ Turn 2 (agent):  "원인: 429 rate limit, 재시도 로직 추가 제안" │
│  ⚙ 위임 제안 중                              ⏳ 진행     │
│                                                            │
│ ┌ ApprovalSheet(inline) ───────────────────────────────┐ │
│ │ propose_delegation → Codex에 "재시도 로직 patch" 위임 │ │
│ │              [Accept] [Edit] [Ignore]                 │ │
│ └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**구성요소**: `AgentTurn`(×N, 에이전트/시스템 발화), `ToolCallBadge`(×N, 각 tool 호출), 인라인 `ApprovalSheet`(pending_approvals가 이 세션에서 나왔을 때).

**Hermes 세션 배지(마스터 Q7)**: `agent_sessions.runtime_id`가 Hermes 런타임이고 아직 Phase C(위임 대상 편입) 전이면, 세션 헤더의 런타임 아이콘 옆에 회색 `Badge`로 "읽기 전용"을 표시한다(Phase B는 read-only 세션 노출만, §2.3의 "Delegate to Hermes…" 액션은 Phase C부터 활성화). 배지가 있는 세션은 `d`(delegate) 단축키와 ApprovalSheet의 위임 진입점이 비활성 상태로 렌더링된다. Phase C로 전환되면 배지가 사라지고 다른 런타임 세션과 동일하게 동작한다.

**ToolCallBadge / TOOL_LABELS 패턴(A5-D11, agentic-inbox 이식 `22`)**: agentic-inbox의 `TOOL_LABELS` record(tool 이름 → `{label, icon}`)와 `state`(AI SDK `UIMessage` part 기준 `output-available`/`result`/`output-error`=완료, 그 외=로딩) 패턴을 omnis 에이전트 tool 목록(마스터 §11)에 맞게 그대로 이식한다:

```ts
const TOOL_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  read:               { label: '읽는 중',           icon: Eye },
  search_memory:      { label: '메모리 검색 중',     icon: Search },
  read_calendar:      { label: '캘린더 확인 중',     icon: Calendar },
  read_session:       { label: '다른 세션 확인 중',   icon: MessagesSquare },
  propose_draft:      { label: '답장 초안 작성 중',   icon: PenLine },
  propose_task:       { label: '할 일 추출 중',       icon: ListChecks },
  propose_delegation: { label: '위임 제안 중',        icon: Share2 },
  propose_route:      { label: '노트 라우팅 제안 중', icon: Route },
};
// state: 'loading' → 스피너, 'done' → label + ✓ + 결과 요약 1줄, 'error' → label + ⚠ + 재시도
```

`propose_*` 계열 tool이 완료되면 배지가 `pending_approvals` 카드로 전이(별도 컴포넌트가 아니라 같은 배지 자리에서 확장). `send`/`delete`/`delegate`/`calendar_write`는 에이전트 tool palette에 없으므로(마스터 §11 원칙) 이 화면에 **에이전트가 직접 호출한 배지로는 절대 나타나지 않는다** — 승인 후 시스템이 실행한 결과만 별도 시스템 Item(kind `system`)으로 한 줄 로그된다(예: "✓ Codex에게 위임됨 · 09:41"). 이 구분(에이전트 제안 배지 vs 시스템 실행 로그)은 §9 QA 체크리스트 항목.

**"Read session" 버튼**: 다른 에이전트 세션의 durable 요약을 인라인 패널로 펼친다(마스터 §9 `read_session(session_key)`의 UI 표현) — raw 토큰 로그가 아니라 요약 + 마지막 N턴만.

**상태**: 로딩(세션 연결 중 — "Codex에 연결하는 중…" 스피너), 빈(신규 세션, 첫 턴 대기), 오류(브리지 연결 실패 — "macbook의 local-agent에 연결할 수 없음, Tailscale 확인" + 재연결 버튼), 오프라인(세션이 다른 기기에서 돌고 있어 로컬 캐시로 마지막 상태만 표시, "실시간 아님" 배지).

**데이터 바인딩**:
```ts
zero.query('items').where('thread_id', '=', sessionThreadId).where('kind', 'IN', ['agent_turn', 'tool_call', 'system']).orderBy('sent_at', 'asc')
zero.query('agent_sessions').where('id', '=', sessionId) // state, capabilities, host
```

**인터랙션**: `d`로 이 세션에 후속 delegate 요청 팔레트, ApprovalSheet 키맵은 §3.9 공통 규칙(A5-D10) 재사용.

**접근성**: tool 배지의 스피너는 `aria-busy="true"`, 완료 시 `aria-live="polite"`로 결과 1줄만 알림(스트리밍 토큰 하나하나는 알리지 않음 — ephemeral 이벤트는 스크린리더에도 노출 안 함, 마스터 §7 이벤트 3티어와 일치).

### 3.4 Today

**목적**: 아침 브리핑 + 오늘 일정 + 대기 중 승인을 한 화면에.

```
┌ Today ─────────────────────────────────────────────────┐
│ 좋은 아침이에요, Logan. 오늘 처리할 항목 12개, 대기 중  │
│ 승인 4건.                                                 │
│                                                            │
│ 🌙 밤 다이제스트 준비됨 · 42개 보관됨          [보기 →]    │  ← Digest 진입 카드(있을 때만)
│                                                            │
│ ⏰ 오늘 일정 (Google Calendar)                            │
│   10:00  Davich PoC 리뷰                                  │
│   15:00  1:1 with 대표님                                  │
│                                                            │
│ 📋 아침 브리핑 (밤 사이 생긴 것 중 중요도순)               │
│   1. [Gmail] 계약서 서명 요청 — 오늘 마감                  │
│   2. [Slack] #davich 채널 3건 새 메시지                    │
│   3. [Agent] Codex adapter 테스트 완료 · 검토 필요          │
│                                                            │
│ ⏳ 대기 중 승인 (4)                                        │
│   [Gmail 답장]  [Codex 위임]  [Calendar 이벤트]  [메시지]   │
└────────────────────────────────────────────────────────┘
```

**구성요소**: `DigestCard`(오늘용, kind='morning'), **밤 다이제스트 진입 카드**(kind='nightly'인 가장 최근 digest가 있을 때만 노출 — iPhone에서 Digest 화면으로 가는 2개 경로 중 하나, 나머지 하나는 §4.4 Web Push "밤 다이제스트 준비됨"; macOS는 이 카드 없이 사이드바/⌘K/`g d`로 대체), 캘린더 이벤트 리스트(당일만, Google Calendar 연동), 승인 대기 칩 스트립(클릭 시 인라인 `ApprovalSheet` 확장).

**데이터 바인딩**:
```ts
zero.query('digests').where('kind', '=', 'morning').where('for_date', '=', today).one()
zero.query('digests').where('kind', '=', 'nightly').orderBy('for_date', 'desc').limit(1) // 진입 카드용
zero.query('items').where('kind', '=', 'event').where('sent_at', 'BETWEEN', [todayStart, todayEnd])
zero.query('pending_approvals').where('state', '=', 'pending').orderBy('created_at', 'asc')
```

**상태**: 로딩(브리핑 생성 전 — 밤 배치 잡이 아직 안 돌았으면 "브리핑 준비 중, N분 후 갱신" placeholder), 빈(오늘 일정/승인 없음 — "오늘은 조용하네요"), 오류(브리핑 생성 실패 — 캘린더/승인 섹션은 독립적으로 계속 렌더링, 브리핑 섹션만 재시도 버튼), 오프라인(캐시된 마지막 브리핑 + "N시간 전 기준" 배지).

**인터랙션**: 브리핑 항목 클릭 시 해당 Thread로 딥링크 이동, 승인 칩 클릭 시 그 자리에서 확장(별도 화면 이동 없음 — 브리핑 커버리지 지표를 위해 "브리핑에서 바로 처리"를 마찰 없이), 밤 다이제스트 카드의 `[보기 →]` 클릭 시 Digest 화면(§3.8)으로 이동(iPhone에서는 이 카드 + Web Push 1종이 유일한 진입로, 탭바에는 없음 — §4.1).

**접근성**: 인사말/요약 텍스트는 `<h1>`로 스크린리더가 페이지 요지를 즉시 읽게, 승인 칩은 `aria-label="대기 중 승인: Gmail 답장, 2026-09-20 09:00 요청"`.

### 3.5 Tasks

**목적**: 에이전트와 함께 쓰는 투두. 출처(어떤 메시지에서 왔는지)가 항상 보임.

```
┌ Tasks ─────────────────────────────────────────────────┐
│  [Today] [This week] [Someday] [Delegated]               │
│                                                            │
│  ☐ Davich PPT 초안 리뷰          from: Gmail · 오늘 마감  │
│  ☐ 계약서 서명                    from: Gmail · 오늘        │
│  ◐ adapter 테스트 수정 (Codex)    delegated · 진행 중       │
│  ☑ Sora에게 회신                  from: Slack · 완료        │
└────────────────────────────────────────────────────────┘
```

**구성요소**: 뷰 탭 4개(Today/This week/Someday/Delegated — `tasks.due_at` 기준 + `tasks.owner_kind = 'agent'`인 것만 Delegated, A3 `tasks_owner_ck` 값은 `'me'|'agent'`), `TaskRow`(체크박스 + 제목 + 출처 링크 + 상태 아이콘 + `tasks.kind`(`todo`/`followup`/`delegation`, A3)에 따른 아이콘 구분).

**데이터 바인딩**:
```ts
zero.query('tasks').where('state', '!=', 'done').where(view === 'delegated' ? ['owner_kind', '=', 'agent'] : ['due_at', 'BETWEEN', viewRange])
  .related('source_item') // 출처 메시지로 딥링크
```

**상태**: 로딩(skeleton 행), 빈(뷰별로 다른 카피 — "오늘 할 일이 없어요" 등, §8), 오류(task 추출 파이프라인 실패는 조용히 무시 가능하나 위임 상태 폴링 실패는 `TaskRow`에 "상태 확인 불가" 경고), 오프라인(체크 토글은 로컬 즉시 반영 후 큐잉).

**인터랙션**: 체크박스 클릭 = `state: done`(낙관적 업데이트), `t` 단축키로 빠른 task 추가 입력(제목만, 나머지는 나중), Delegated 행 클릭 시 해당 Agent Session으로 이동.

**접근성**: 체크박스는 네이티브 `<input type="checkbox">`(커스텀 아님 — 스크린리더/키보드 호환성이 네이티브가 가장 안전), 완료 취소선은 `text-decoration` + `aria-checked` 동시 반영.

### 3.6 Network

**목적**: 개인 CRM. 사람 카드 + 팔로업 큐. Dex(`17`)를 1차 레퍼런스로 삼되 팀 기능은 제외(1인용).

```
┌ Network ───────────────────────────────────────────────┐
│  [Follow-up queue (3)]     🔍 검색                        │
│                                                            │
│ ┌ PersonCard ──────────┐ ┌ PersonCard ──────────┐        │
│ │ 🟢 David Park          │ │ ⚪ Sora Kim            │        │
│ │ Davich · CTO           │ │ Ownered Lab · PM       │        │
│ │ 마지막 연락: 3일 전     │ │ 마지막 연락: 오늘       │        │
│ │ 팔로업 제안: "PoC 결과 │ │                        │        │
│ │  공유 후 미응답 5일"   │ │                        │        │
│ │        [Edit & send]   │ │                        │        │
│ └────────────────────────┘ └────────────────────────┘        │
└────────────────────────────────────────────────────────┘
```

**구성요소**: `PersonCard`(사람 그리드/리스트 토글), Follow-up queue 상단 스트립(folk Follow-up Assistant 패턴 `17` — 비활성 대화 감지 + 톤매칭 draft), 사람 상세 뷰(클릭 시 우측 pane: 상호작용 타임라인 + 전 채널 대화 링크 + 메모).

**PersonCard 명세**: 아바타/이니셜, 이름, 소속·직함(`entities` 연결), 관계 상태 dot(`persons.relationship_state` 전체 값 `unknown/new/warming/active/dormant/closed`(마스터 §6) 중 카드에 노출하는 3단 — 🟢 `active`/🟡 `new`·`warming`(관계 형성 중)/⚪ `dormant`·`closed`(방치 위험) — `unknown`은 dot 없이 텍스트만 "정보 부족"), 팔로업 제안이 있으면 카드 하단에 `DraftCard`의 축소판(같은 "Edit & send" 게이트).

**데이터 바인딩**:
```ts
zero.query('persons').orderBy('last_contact_at', 'desc').related('identities')
// 팔로업 큐: threads.person_id는 마스터 스키마에 없다(participants[]만 있음) — A3 v0.95가 추가한
// persons.primary_thread_id로 역방향 조인한다(persons → primaryThread → 그 스레드의 draft item), 99-review-v2 §2-4
zero.query('persons')
  .where('id', 'IN', followUpCandidateIds)
  .related('primaryThread', t => t
    .related('items', i => i.where('status', '=', 'draft').orderBy('sent_at', 'desc').limit(1))
  )
```

**상태**: 로딩(카드 skeleton grid), 빈("아직 연락처가 없어요 — 인박스에서 자동으로 채워집니다"), 오류(팔로업 제안 생성 실패는 카드에서 조용히 생략, 사람 데이터 자체는 정상 렌더링), 오프라인(마지막 캐시).

**인터랙션**: 카드 클릭 → 우측 pane 상세, 팔로업 draft는 Thread의 DraftCard와 동일한 버튼 세트(Edit & send/Discard/Regenerate).

**접근성**: 카드 그리드는 `role="grid"` 또는 리스트 토글 시 `role="list"`, 관계 상태 dot은 색만이 아니라 텍스트 레이블 동반("활성" / "방치 5일" 등).

### 3.7 Notes

**목적**: 노트 한 줄 입력 → 라우팅 제안(마스터 §11 노트 라우팅 루프의 UI). 상용 전례가 없는 기능이라(`17`) UI는 최대한 단순하고 되돌리기 쉽게.

```
┌ Notes ─────────────────────────────────────────────────┐
│ ┌ 새 노트 ──────────────────────────────────────────┐   │
│ │ David한테 PoC 3주 더 필요하다고 미리 언질...        │   │
│ │                                          [저장]     │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│  라우팅 제안: David Park 스레드에 공유 (신뢰도 높음)       │
│              [수락]  [다른 대상 선택]  [라우팅 안 함]      │
│                                                            │
│  최근 노트                                                 │
│   "Davich 계약서 초안 관련 메모..."  → Network:David       │
│   "다음 주 회고 아이디어"            → 라우팅 안 함         │
└────────────────────────────────────────────────────────┘
```

**구성요소**: 노트 입력창(단일 라인, Enter로 저장 or 확장해 여러 줄), `RoutingSuggestion`(신뢰도 표시 + 3버튼), 최근 노트 리스트(라우팅 결과 표시).

**상용 전례 없음(`17` §4)이므로 설계 원칙**: 신뢰도가 낮으면 자동 제안 자체를 하지 않고 "라우팅 대상을 찾지 못했어요 — 수동으로 선택" 만 보여준다. 자동 라우팅(승인 없이 바로 붙임)은 하지 않는다 — 항상 사람이 "수락" 버튼을 눌러야 `notes.routed_to`가 확정된다(propose_route 역시 다른 propose_* 와 동일하게 비가역 아님/제안만).

**데이터 바인딩**:
```ts
zero.query('notes').orderBy('created_at', 'desc').limit(20)
// 라우팅 제안은 notes insert 직후 propose_route 결과를 폴링/구독
```

**상태**: 로딩(저장 직후 라우팅 제안 계산 중 — 스피너 200ms 이상일 때만 노출, 아래일 땐 즉시 결과), 빈("아직 노트가 없어요"), 오류(라우팅 제안 실패는 "라우팅 대상을 찾지 못했어요"로 수렴 — 에러와 no-match를 사용자에게 구분해서 보여주지 않음, 실패도 안전한 기본 상태), 오프라인(노트 저장은 로컬 우선, 라우팅 제안은 재연결 후).

**인터랙션**: `n` 전역 단축키로 어디서든 노트 입력 포커스(마스터 §12 핵심 인터랙션과 일치), 저장 후 자동으로 입력창 초기화 + 포커스 유지(연속 입력 가능).

**접근성**: 라우팅 제안의 신뢰도는 텍스트로("신뢰도 높음"/"낮음", 퍼센트 노출은 사용자에게 의미 없는 숫자라 배제).

### 3.8 Digest

**목적**: 밤 아카이브 다이제스트(매일 23:00 KST 생성, 아침 브리핑은 06:30 KST — 스케줄 오너는 A4 §6, 마스터 §14) — 그날 자동 보관된 것 중 다시 볼 것 확인 + 되살리기.

```
┌ Digest ────────────────────────────────────────────────┐
│  9월 19일 밤 다이제스트 · 42개 보관됨                     │
│                                                            │
│  📧 이메일 (31)                                            │
│   뉴스레터 12건, 알림 8건, 영수증 11건 — [모두 보기]        │
│  💬 메시지 (11)                                            │
│   Slack #random 8건, WhatsApp 그룹 3건                     │
│                                                            │
│  이번 달 비용 리포트: $34 / $60 (57%)                       │
└────────────────────────────────────────────────────────┘
```

**구성요소**: `DigestCard`(kind='nightly'), 카테고리별 접힌 그룹(클릭 시 개별 아이템 리스트 펼침), 각 아이템에 "되살리기"(archived_at을 null로) 버튼, 월간 비용 리포트 섹션(마스터 §14 비용 정책의 UI 노출 지점).

**데이터 바인딩**:
```ts
zero.query('digests').where('kind', '=', 'nightly').orderBy('for_date', 'desc').limit(1)
zero.query('items').where('id', 'IN', digest.items) // 펼쳤을 때만 개별 조회
```

**상태**: 로딩("오늘 밤 다이제스트는 아직 생성 전이에요, 23:00에 생성됩니다"), 빈(보관된 게 없던 날 — "오늘은 보관할 게 없었어요"), 오류(다이제스트 배치 잡 실패 — "다이제스트 생성 실패, 수동으로 다시 시도" 버튼, cron job 재실행), 오프라인(마지막 캐시된 다이제스트).

**Thread에서의 되살리기 어포던스**: `threads.archived_at`이 채워져 있고 7일 이내면(§6.4 undo 윈도우, 마스터 §11), Thread 헤더(§3.2)에 "자동 보관됨 · {N}일 전 — 되살리기" 인라인 배너를 노출한다(오프라인 배너와 동일한 톤의 상단 고정 바). "되살리기" 클릭 = Digest의 되살리기와 같은 동작(`archived_at`을 null로, toast "되살렸습니다 · 실행 취소"). 7일이 지나면 배너 없이 조용히 보관 상태만 유지(검색으로 여전히 도달 가능).

**인터랙션**: 카테고리 헤더 클릭 = 아코디언 토글, 개별 아이템의 "되살리기" = 즉시 Inbox로 복귀(낙관적 업데이트 + toast "되살렸습니다, 실행 취소").

**접근성**: 아코디언은 `aria-expanded`, 되살리기 액션 후 toast는 `role="status"`.

### 3.9 Settings

**목적**: 계정 연결, 자율 허용 규칙, 모델 티어, kill switch — 마스터 §12/§14/§19의 모든 사용자 노출 설정.

```
┌ Settings ──────────────────────────────────────────────┐
│  Accounts        Autonomy       Model tiers    General   │  ← 좌측 서브 nav
│ ─────────────────────────────────────────────────────── │
│  Accounts                                                 │
│   Slack        ● connected      [재연결]                  │
│   Gmail        ● connected      [재연결]                  │
│   KakaoTalk    ● read only      [send 활성화 (D-9)]  ⓘ      │
│   ...                                                      │
│                                                            │
│  ⚠ Kill switch                    [모든 자율 실행 중지]    │
└────────────────────────────────────────────────────────┘
```

**구성요소**: 좌측 서브 nav 4개(Accounts/Autonomy/Model tiers/General), 각 섹션은 표준 폼 레이아웃(shadcn Form). **Autonomy** 섹션은 채널·사람별 "자율 허용"(마스터 §7 승인 게이트 기본값 override) 토글 — 기본은 전부 꺼짐(승인 필요), 켜면 경고 다이얼로그("이 채널/사람에게는 승인 없이 자동 발송됩니다, 계속하시겠어요?") 필수. **Model tiers**는 현재 월 사용량 게이지 + 비용 상한 입력(아래 명세) + 민감도 규칙 표시(읽기 전용, 마스터 D9/§14는 재논의 대상 아님이라 여기선 토글 아님). Kill switch는 Settings와 macOS 메뉴바 트레이 양쪽에 동일 버튼(마스터 §7).

**비용 상한(마스터 §14, A4 §10.4, 99-review §1.2 "A5 §3.9 비용 상한 읽기 전용 ↔ A4 §10.4 Settings에서 변경 → A5" 반영)**: 월 상한은 **읽기 전용이 아니라 편집 가능한 숫자 입력**이다(기본값 $60). Model tiers 섹션에 3개를 함께 보여준다 — ① 이번 달 현재 지출(예: "$34 사용"), ② 그 아래 진행률 바(전체 폭 = 상한, 채워진 폭 = 지출, 마지막 10%는 시각적으로 구분된 세그먼트로 "VIP·민감 예비비"를 표시), ③ 상한 숫자 입력 필드(변경 시 "저장" 버튼, 즉시 반영). 예비비 10%는 편집 불가(상한에 종속된 계산값)이고, 그 옆에 "VIP·민감 스레드 예비비"라는 라벨과 함께 고정 텍스트로만 노출한다. 80%/100% 임계값은 진행률 바 색으로도 구분(정상 `--accent`, 80%↑ `--warn-500`, 100%↑ `--danger-500`) — 색만이 아니라 바 위 텍스트도 "정상"/"T2→T1 강등"/"비VIP 초안 중단"으로 함께 병기(§9 접근성 규칙).

**KakaoTalk send 게이팅(마스터 §3/§19 Q3, 99-review §4 항목13)**: KakaoTalk의 read 연결이 안정적으로 14일을 채우기 전엔 `[send 활성화]` 버튼이 **비활성(disabled)**이고, 버튼 라벨은 남은 일수를 "send 활성화 (D-{N})"로 표시한다. 버튼에 마우스를 올리면(또는 모바일에서 탭하면) 툴팁 "read 안정화 {14-N}/14일 · {N}일 후 활성화"가 뜬다. 같은 잔여일 정보를 Accounts 행 자체에도 병기해(위 목업 `ⓘ` 아이콘 hover/탭과 동일 텍스트) 툴팁을 못 보는 상황(스크린리더·터치 long-press 실패)에서도 전달되게 한다. 14일을 채우면 버튼이 활성화되고 라벨이 "send 활성화"로 바뀌며, 눌러도 즉시 발신되지 않고 이후 모든 KakaoTalk 발신은 여전히 `ApprovalSheet` 승인을 거친다(이 버튼은 어댑터의 send capability를 켜는 것이지 승인 게이트를 우회하지 않는다).

**상태**: 로딩(각 계정 상태 폴링 중 스피너), 빈(해당없음 — 8채널이 항상 리스트), 오류(재연결 실패 시 인라인 에러 + 재시도), 오프라인(계정 상태는 마지막 캐시, "실시간 아님" 배지, 토글 변경은 재연결 후 적용).

**인터랙션**: Kill switch는 2단계 확인(버튼 클릭 → "정말로 모든 자율 루프를 멈추시겠어요?" 확인 다이얼로그 → 실행), 되돌리기는 1클릭.

**접근성**: 토글은 네이티브 역할(`role="switch"` + `aria-checked`), 위험한 설정(자율 허용, kill switch)은 색만으로 위험도를 표현하지 않고 아이콘+텍스트 병행(§9 색맹 대응).

---

## 4. iPhone (PWA) 레이아웃

Phase B는 installed PWA(마스터 D8, Q1 기본값). 목표는 "한 손 triage" — 긴 편집은 맥으로 넘긴다는 마스터 원칙(§12)을 레이아웃 자체로 강제한다.

### 4.1 레이아웃

```
┌ iPhone ──────────┐
│ 받은 편지함   ⌘K │  ← 상단 바(현재 탭 제목 + 검색), 좌측 상단 ⚙는 모든 화면 공통
├────────────────────┤
│ ⬤ Sora   · 09:14 [G]│  ← 단일 컬럼 리스트, 스와이프 존
│   "회의 자료 확..." │
│ ○ Codex  · 10:02 [◆]│
├────────────────────┤
│ 📥  🏠  ✓  👤  📝 │  ← 하단 탭바(5): Inbox/Today/Tasks/Network/Notes
└────────────────────┘
```

하단 탭바는 **Inbox·Today·Tasks·Network·Notes 5개 고정**이다(마스터 §3 "핵심 인터랙션", 99-review §4 항목11 "탭바 5칸 유지"). Inbox가 앱을 열면 처음 보이는 탭(가장 자주 쓰는 화면). **Digest는 탭바에 없다** — iPhone에서 Digest로 가는 경로는 §3.4의 Today 상단 카드와 §4.4의 Web Push 1건뿐으로 의도적으로 한정한다(macOS는 사이드바+`g d`+⌘K 3중 진입로가 있지만, 폰에서는 밤 다이제스트가 "매일 챙겨야 하는 1급 화면"이 아니라 "있으면 열어보는" 화면이라 탭 하나를 내주지 않는다). Settings도 탭바에서 빠지고 상단 바 좌측의 ⚙ 아이콘(모든 탭에서 공통 노출)으로 이동 — 트리아지 중 가장 안 쓰는 화면에 탭 한 칸을 쓰지 않는다.

### 4.2 스와이프 액션

리스트 행 좌우 스와이프(Superhuman/Gmail 표준 관행 확장):
- **오른쪽으로 스와이프**(부분) = Archive(`e`와 동일), 끝까지 = 즉시 실행
- **왼쪽으로 스와이프**(부분) = 액션 메뉴 노출(Snooze/Label/Delegate 아이콘 3개), 끝까지 = 기본 액션(Snooze)
- 승인 대기 아이템은 스와이프 대신 탭하면 바로 `ApprovalSheet`가 바텀시트로 열림(모바일에서 승인은 스와이프가 아니라 명시적 탭+확인 — 실수 방지)

### 4.3 승인·스누즈·짧은 답장·노트 입력

- **승인**: 바텀시트(`ApprovalSheet`, 맥과 동일 컴포넌트, 반응형 레이아웃만 다름), 전문 노출 + Accept/Edit/Ignore 버튼(데스크톱과 동일 4-way config, 단 모바일에서 `respond`는 텍스트 입력이 작아 후순위 — 버튼 순서만 Accept 우선)
- **스누즈**: 프리셋 4개(1시간 후/저녁에/내일/다음 주) 바텀시트, 커스텀 시간은 숨겨진 "직접 선택" 하나로 축소(모바일에서 데이트피커 전체 노출은 화면 낭비)
- **짧은 답장**: DraftCard의 "Edit & send"는 모바일에서 전체 화면 Composer로 전환(Tiptap 모바일 최적화, 서식 없이 텍스트만 — 표/이미지 삽입 등은 "맥에서 편집" 안내로 대체). 짧은 정형 답장("확인했습니다", "곧 답변드릴게요")은 draft 카드 아래 quick-reply chip 3개로 원탭 전송 가능(전송 전 승인 시트는 그대로 거침)
- **노트 입력**: 하단 탭바 Notes 탭 → 진입 즉시 텍스트 입력에 자동 포커스(맥의 §3.7과 동일 화면, 빠른 캡처를 위해 입력창이 최상단), 저장 시 라우팅 제안은 다음 화면이 아니라 같은 화면 하단에 인라인으로

### 4.4 Web Push

Phase B는 Web Push만(APNs는 v2 네이티브 셸, `13`). **Digest 진입 푸시는 1종**(밤 다이제스트 준비됨 하나 — 마스터 §12, 99-review-v2 §4-1로 한정)이지만, **초안 알림은 A4 §3.6의 3등급을 그대로 폰에도 적용한다**(알림 정책 오너는 A4 §3.6, A5는 그 렌더링만 맡는다). 하단 탭바는 §4.1과 동일하게 Inbox/Today/Tasks/Network/Notes 5개 그대로다 — 초안 알림 3등급은 새 탭이 아니라 기존 푸시 종류의 세분화다.

**초안 즉시 푸시 카드**(A4 §3.6 "즉시 푸시"): `priority='now'` AND (`vip` OR 스레드에 내 이름 멘션 OR 캘린더상 2시간 내 미팅 상대)일 때만 발송. 본문은 초안 첫 **80자 미리보기**(전문 아님 — A4 §3.6 프라이버시 원칙, 잠금화면에 전문 노출 안 함). 액션 버튼은 A4 §3.6이 정의한 **Approve / Open** 2개(Web Notification action, 최대 2개): **Approve**는 그 자리에서 `pending_approvals(action='send')`를 accept해 앱을 열지 않고 바로 발송, **Open**은 앱을 열어 해당 `DraftCard`로 딥링크(§6 `omnis://thread/{id}` 스킴). 카드 본문(액션 버튼이 아닌 부분)을 탭해도 Open과 동일하게 동작 — §4.2 "승인 대기 아이템은 탭하면 바로 열림" 원칙과 일치.

**초안 묶음 푸시**(A4 §3.6 "묶음"): `priority='today'`인 초안은 건별로 푸시하지 않고 3시간 간격(09/12/15/18 KST)으로 모아 "초안 {N}건 준비됨" 1건만 보낸다. 탭 시 특정 스레드가 아니라 Inbox로 이동(어떤 스레드인지는 인박스에서 확인).

**무음**(A4 §3.6 "무음"): 그 외 우선순위 낮은 초안은 푸시 없음 — 인박스 배지와 아침 브리핑에만 반영된다.

**전역 조용시간**(A4 §3.6): 23:00~07:00 KST에는 즉시 푸시도 묶음으로 내려가고 07:00 아침 브리핑과 함께 한 번 나간다. 예외는 `vip` AND `priority='now'` 하나뿐이며 Settings에서 끌 수 있다 — 맥과 동일한 정책이고 A5가 별도 규칙을 두지 않는다.

그 외 알림 종류:

| 종류 | 트리거 | 문구 패턴 |
|---|---|---|
| 승인 대기(초안 외 — delete/delegate/calendar_write 등) | `pending_approvals` 신규 생성 | "{action} 승인이 필요해요 · {대상 요약}" |
| VIP 메시지 | 라벨 `priority:vip` 아이템 도착 | "{이름}님에게서 메시지가 왔어요" |
| 아침 브리핑 준비됨 | `digests(kind=morning)` 생성 완료 | "오늘의 브리핑이 준비됐어요 · N건" |
| 밤 다이제스트 준비됨 | `digests(kind=nightly)` 생성 완료(23:00 KST 직후) | "밤 다이제스트 준비됨 · {N}개 보관" — 탭 시 Today 상단 카드를 거치지 않고 Digest 화면으로 바로 이동 |
| 팔로업 리마인드 | Network 팔로업 큐 신규 | "{이름}님과 {N}일째 연락이 없어요" |
| 채널 연결 끊김 | 어댑터 `health()` 실패 | "{채널} 연결이 끊겼어요, 확인해주세요" |

Web Push는 iOS 백그라운드 신뢰성이 제한적이므로(`13`) 맥미니의 ntfy 이중화는 macOS 앱에만 적용하고(마스터 §15), iPhone은 Web Push 단일 경로로 시작 — 배달 누락이 반복되면 v2 네이티브 전환의 근거 지표로 기록한다.

### 4.5 설치 안내

첫 방문 시 Safari 상단에 "홈 화면에 추가" 유도 배너(iOS 26부터 홈 화면 추가 시 기본이 웹앱 모드라 별도 유도가 이전보다 덜 필요하지만, PWA 설치 자체는 여전히 사용자 액션 필요, `13`): 3단계 카드(공유 버튼 탭 → "홈 화면에 추가" → 완료), Web Push 권한은 설치 직후가 아니라 **첫 승인 대기 항목이 생겼을 때** 컨텍스트 안에서 요청(권한 요청을 이유 없이 앱 시작 시 바로 띄우지 않음 — 권한 수락률을 높이는 표준 관행).

---

## 5. 컴포넌트 맵

### 5.1 shadcn/ui (그대로 사용)

Button, Input, Textarea, Select, Checkbox, Switch, Dialog, Sheet, Popover, DropdownMenu, Command(cmdk 래핑), Tabs, Badge, Avatar, Tooltip, Separator, ScrollArea, Toast(Sonner 래핑), Form(react-hook-form 결합).

### 5.2 커스텀 컴포넌트 (9개)

| 컴포넌트 | 역할 | 주요 의존 |
|---|---|---|
| `InboxRow` | 리스트 행(아바타+이름+타임스탬프+프리뷰+채널아이콘+unread) | Avatar, 자체 CSS(§3.1) |
| `ThreadView` | 메시지 리스트 + 헤더 + Composer 컨테이너 | react-virtuoso, Tiptap |
| `DraftCard` | 초안 전문 + Edit&send/Discard/Regenerate | Card, Button |
| `ApprovalSheet` | HumanInterrupt 4-way(accept/edit/respond/ignore) 렌더링 | Sheet(맥) / Sheet as bottom-sheet(모바일) |
| `AgentTurn` | 에이전트 발화 1턴 + 그 턴에 속한 ToolCallBadge 그룹 | — |
| `ToolCallBadge` | TOOL_LABELS 매핑 기반 tool 진행 상태 배지 | Badge, lucide 아이콘 |
| `PersonCard` | Network 사람 카드(그리드/상세 공용) | Avatar, Badge |
| `CommandPalette` | ⌘K 전역 액션 등록·실행 | Command(cmdk) |
| `DigestCard` | morning/nightly 다이제스트 공용 카드(카테고리 아코디언) | Accordion(shadcn 확장) |

### 5.3 라이브러리 사용처

- **react-virtuoso**: `InboxRow` 리스트(Inbox), `AgentTurn` 리스트(Agent Session), `TaskRow` 리스트(Tasks) — 동적 높이·그룹 헤더가 필요한 모든 긴 리스트. 10만 항목 규모 대응(`14`).
- **Tiptap**: `ThreadView`의 Composer, `DraftCard`의 Edit 모드 에디터. AI 확장(슬래시 커맨드로 "톤 바꾸기", "짧게 줄이기" 등 향후 확장 여지, `14`)은 v1 범위 밖이나 에디터 자체는 Tiptap으로 시작해 확장 비용을 낮춘다.
- **cmdk (shadcn Command)**: `CommandPalette` 전체.

---

## 6. Tauri 셸

- **윈도우**: 단일 메인 윈도우, `titleBarStyle: "overlay"`(macOS 트래픽라이트 유지하되 커스텀 타이틀바), 최소 크기 1024×640, 사이드바 접힘 상태 기억(로컬 설정 파일).
- **Vibrancy**: 사이드바 레이어에 `window-vibrancy`의 `apply_liquid_glass`(macOS 26+) 우선 적용, 실패 시 `apply_vibrancy(NSVisualEffectMaterial::Sidebar)`로 폴백, 그마저 실패 시 §1.5의 CSS `.glass-surface` 폴백(`14` §7 불안정성 대응).
- **트레이**: 메뉴바 아이콘 상주(승인 대기 개수를 배지로), 클릭 시 최근 승인 대기 3건 미니 리스트 + "omnis 열기" + "Kill switch" + "종료". 창을 닫아도 트레이에서 계속 실행(맥미니 허브와 별개로 맥북 앱 자체도 브리지 데몬 역할을 하므로 완전 종료는 의도적 행동으로 취급).
- **알림**: Tauri notification 플러그인으로 네이티브 macOS 알림(Web Push와 별도 경로 — 맥 앱은 항상 켜져 있다는 전제라 네이티브 알림이 1차, Web Push는 앱이 안 켜져 있을 때의 폴백 개념으로 iPhone과 대칭).
- **단축키**: 전역 단축키 1개만 OS 레벨로 등록 — `⌘⇧O`(omnis 열기/포커스, 다른 앱 사용 중에도). 그 외 모든 단축키(§2.4)는 앱 포커스 상태에서만 동작하는 인앱 키맵(OS 전역 등록 안 함 — 다른 앱과 충돌 방지).
- **딥링크**: `omnis://thread/{id}`, `omnis://approval/{id}`, `omnis://person/{id}` 스킴 등록. Web Push/네이티브 알림 클릭, Digest 이메일(향후) 등에서 앱을 열고 바로 해당 화면으로 이동하는 데 사용.

---

## 7. 빈 상태·온보딩

### 7.1 계정 연결 플로우

```
1. Welcome           "omnis에 오신 걸 환영해요"
2. Connect channels   Slack/Gmail/Outlook/Calendar/Telegram (OAuth, 순서 무관 스킵 가능)
                       WhatsApp/KakaoTalk/LinkedIn = "맥미니에서 설정 필요" 안내 카드
                       (마스터 D12의 정직한 정의를 온보딩에서도 숨기지 않는다 — Phase A엔 3채널만 필수)
3. Self-model seed     USER.md 초안 질문 5개(역할, 톤, 우선순위) → 최소 응답으로 시작 가능(전부 skip 허용)
4. First sync          "메시지를 가져오는 중…" (backfill 진행률 바, 채널별)
5. First briefing      완료 즉시 Today 화면으로 이동, 첫 브리핑 생성 중이면 §3.4 로딩 상태
```

**Phase A 필수 채널은 Slack/Gmail/Calendar 3개뿐**(마스터 §16 Phase A 범위와 일치) — 온보딩에서 Outlook/Telegram/WhatsApp/KakaoTalk/LinkedIn은 "나중에 연결" 버튼으로 항상 스킵 가능, Settings > Accounts에서 언제든 추가.

### 7.2 화면별 빈 상태 요지 (상세 카피는 §8)

Inbox 빈 = 축하 톤 아님, 중립("받은 편지함이 비어 있습니다"). Tasks 빈 = 뷰별 분기. Network 빈 = 자동 채움을 안내(사람이 직접 추가하는 화면이 아님을 명확히). Notes/Digest 빈 = 담백하게.

---

## 8. 마이크로카피 표

기본은 한국어, 괄호 안 영어는 코드/aria-label에 쓰는 영어 원문(병기가 필요한 곳만).

| 위치 | 한국어(기본) | 영어(참고/코드) |
|---|---|---|
| DraftCard 버튼 | 수정 후 보내기 | Edit & send |
| DraftCard 버튼 | 버리기 | Discard |
| DraftCard 버튼 | 다시 생성 | Regenerate |
| ApprovalSheet 버튼 | 승인 | Accept |
| ApprovalSheet 버튼 | 수정 후 승인 | Edit |
| ApprovalSheet 버튼 | 무시 | Ignore |
| ApprovalSheet 버튼 | 응답 | Respond |
| Inbox 빈 상태 | 받은 편지함이 비어 있습니다 | Inbox is empty |
| Inbox 오류(채널 끊김) | {채널} 연결이 끊겼어요 — 재연결 | {channel} disconnected — Reconnect |
| Tasks 빈(Today) | 오늘 할 일이 없어요 | Nothing due today |
| Tasks 빈(Delegated) | 위임한 작업이 없어요 | No delegated tasks |
| Network 빈 | 아직 연락처가 없어요 — 인박스에서 자동으로 채워집니다 | Contacts fill in automatically from your inbox |
| Notes 라우팅 낮은 신뢰도 | 라우팅 대상을 찾지 못했어요 — 수동으로 선택 | Couldn't find a match — pick manually |
| Digest 되살리기 완료 toast | 되살렸습니다 · 실행 취소 | Restored · Undo |
| 오프라인 배너 | 오프라인 — 마지막 동기화 {N}분 전 | Offline — last synced {N}m ago |
| Kill switch 확인 | 정말로 모든 자율 실행을 멈추시겠어요? | Stop all autonomous actions? |
| Autonomy 켜기 경고 | 이 대상에게는 승인 없이 자동 발송됩니다 | Actions to this target send without approval |
| 승인 알림(Web Push) | {action} 승인이 필요해요 · {요약} | {action} needs your approval |
| 채널 미연결(온보딩) | 맥미니에서 설정이 필요해요 | Requires Mac mini setup |
| 첫 동기화 진행 | 메시지를 가져오는 중… | Syncing your messages… |
| 브리핑 준비 중 | 브리핑 준비 중, {N}분 후 갱신 | Preparing your briefing, refreshes in {N}m |

---

## 9. 디자인 QA 체크리스트

구현 완료 후 매 화면마다 아래를 순서대로 확인한다. "AI가 만든 UI" 티는 대부분 이 체크리스트의 위반에서 온다.

**색/토큰**
- [ ] 컴포넌트 CSS가 primitive 토큰을 직접 참조하지 않고 semantic 토큰만 쓰는가(§1.1)
- [ ] 채널 정체성을 리스트 행 배경/아바타 틴트로 표현한 곳이 없는가(오직 우측 고정 아이콘만, §1.1)
- [ ] 액센트 컬러가 CTA·선택 상태·안읽음 배지 외에 남용되지 않았는가(버튼마다 그라디언트 채우기 금지)
- [ ] 그림자가 선택된 리스트 행(`--shadow-row-selected`) 외의 곳에 쓰이지 않았는가(카드 경계는 헤어라인)

**타이포/레이아웃**
- [ ] 폰트 웨이트가 400/510/590 3단 밖으로 나가지 않는가(700+ bold 없음)
- [ ] type scale 6단(12/13/14/16/20/26) 밖의 임의 px 값이 없는가
- [ ] 정보 밀도가 프로덕티비티 앱 수준인가(불필요한 대형 패딩·거대 아이콘으로 "여백 있어 보이게" 늘리지 않았는가)
- [ ] 모든 spacing이 8px 래더(4/8/12/16/24/96) 값인가

**Liquid Glass**
- [ ] 유리 효과가 sidebar/toolbar/sheet/palette 4곳 외에 적용된 곳이 없는가(리스트 행·본문·에디터는 항상 불투명, §1.5)
- [ ] vibrancy 실패 시 CSS 폴백이 실제로 동작하는가(feature-detect 확인)

**모션**
- [ ] duration이 100/160/400ms 3단 밖의 임의 값을 쓰지 않는가
- [ ] 이징이 `--ease-spring` 하나로 통일됐는가(여러 곡선 혼용 금지)
- [ ] `prefers-reduced-motion`에서 실제로 애니메이션이 즉시 완료되는가

**"AI 슬롭" 방지**
- [ ] 보라-파랑 그라디언트 "AI 느낌" 배경/버튼이 없는가(마스터 D8의 단일 액센트 원칙 위반)
- [ ] 장식용 스파클(✨)·로봇 이모지 아이콘이 UI 텍스트에 섞여 있지 않은가
- [ ] 카드마다 다른 corner radius를 임의로 쓰지 않고 4단(6/10/16/999)만 쓰는가
- [ ] 버튼/입력창이 전부 full-radius(pill)로 통일되지 않고, 계층에 따라 sm/md만 쓰는가(pill은 검색/커맨드 입력 전용, 마스터 버튼에 pill 남용 금지)
- [ ] placeholder 텍스트(Lorem ipsum류)나 가짜 데이터가 최종 화면에 남아있지 않은가
- [ ] 에이전트가 제안만 한 것(propose_*)과 실제로 실행된 것(시스템 로그)이 시각적으로 구분되는가(§3.3)

**접근성**
- [ ] 색만으로 상태를 전달하는 곳이 없는가(안읽음 점선 인디케이터, 관계 상태 dot 등은 항상 텍스트/aria-label 동반)
- [ ] 모든 인터랙티브 요소가 키보드로 도달 가능한가(마우스 전용 hover 액션 없음)
- [ ] 포커스 링이 항상 보이는가(`outline: none`으로 지워버린 곳이 없는가)
- [ ] 아이콘 전용 버튼에 `aria-label`이 있는가

**한국어 UI**
- [ ] 존댓말 톤이 일관되는가(버튼은 명령형 단어형 "승인"/"보내기", 안내문은 정중체 "-습니다/-해요" 중 화면 성격에 맞게 일관 — Today/브리핑은 대화체 "-해요", Settings/시스템 메시지는 단정체 "-습니다")
- [ ] 영어 기술 용어(Draft, Approve 등 §8 표의 영어 열)가 코드/aria-label에만 남고 사용자 노출 텍스트는 한국어인가

---

## 리뷰 노트 (2026-09-20)

인라인으로 고친 것(§2, §3.3, §3.1, §3.6 표기 불일치 — 기록만 남김, 재논의 대상 아님):
- A5-D10, §3.3: `delegate.run`/`calendar.write` → `delegate`/`calendar_write`로 정정 — 마스터 §6 `pending_approvals.action` enum과 A3 DDL의 실제 CHECK 제약(`'send','delete','calendar_write','delegate','self_model_edit','memory_write'`)이 이 표기이고, A5 §2.3(`action='delegate'`)도 이미 이 표기를 쓰고 있어 A5 안에서도 서로 달랐다.
- §3.6 데이터 바인딩: 팔로업 큐 쿼리가 `items.kind = 'draft'`로 필터링하고 있었는데, 마스터 §6은 `draft`를 `items.status` 값으로 정의한다(`items.kind`엔 `draft`가 없음, message/email/event/agent_turn/tool_call/system뿐). `status`로 정정.
- §3.1 InboxRow 프리뷰 규칙: `"Draft: {본문 앞부분}"`이 영어로 남아 있었음 — §8 마이크로카피 표·§9 QA 체크리스트("사용자 노출 텍스트는 한국어") 자체 규칙 위반이라 `"초안: {본문 앞부분}"`으로 정정.

v0.95 패스에서 1·2·4번은 해결되어 이 절에서 제거했다(아래 "수정 이력" 참조). 3번(`thread.person_id` 필드가 마스터 스키마에 없던 문제)은 A3의 확정을 기다려야 해서 v0.95까지 남겨뒀으나, pass 2(v1.0)에서 A3 v0.95가 `persons.primary_thread_id`를 신설해 해소됐다 — §3.6 데이터 바인딩을 역방향 조인으로 재작성했다(99-review-v2 §2-4). 이 절의 미해결 항목은 이제 없다.

---

## 수정 이력 (v0.95, 2026-09-20)

전역 리뷰 `99-review.md`(§1.2, §4 항목11~13) 및 마스터 v0.95를 반영해 아래 8건을 고쳤다.

1. 다이제스트 시각 카피 정정: §3.8 로딩 상태 문구 "00:30" → "23:00"(밤 다이제스트), §3.8 목적 줄에 아침 브리핑 06:30 KST도 병기(마스터 §14, A4 §6 스케줄 오너).
2. iPhone 하단 탭바를 Inbox/Today/Tasks/Network/Notes 5개로 재정의(Settings는 §4.1), Today 상단에 밤 다이제스트 진입 카드(§3.4) 추가, Web Push에 "밤 다이제스트 준비됨" 1종 신설(§4.4) — Digest를 탭바에는 넣지 않음(마스터 §3, 99-review §4 항목11).
3. InboxRow 2행 우측에 라벨 칩 2개 + `+N` 명세 신설: 선택 우선순위(scope 우선), 색(라벨 고유 `labels.color`, 채널 브랜드색 금지), 트렁케이션, 접근성(§3.1, 마스터 §3, 99-review §4 항목12).
4. KakaoTalk send 버튼: read 안정 14일 미만이면 비활성 + "D-{N}" 라벨 + 툴팁·Accounts 행에 잔여일 표시(§3.9, 마스터 §3, 99-review §4 항목13).
5. Settings 비용 상한을 읽기 전용 게이지에서 편집 가능한 입력으로 변경, 예비비 10%와 현재 지출을 함께 노출(§3.9, A4 §10.4, 99-review §1.2).
6. ⌘K 통합 검색 모드 신설(§2.5, Phase B): 결과 그룹 4개(threads/items/people/memories), 소스는 A3 `items.search_tsv`·`persons_name_trgm_idx` + `search_memory` tool 계약, 키보드 내비게이션·빈/느림 상태 정의(마스터 §3).
7. Agent Session에 Hermes "읽기 전용" 배지(Phase B, 마스터 Q7) 추가(§3.3), Thread·Digest에 자동 보관 7일 되살리기 어포던스를 양쪽에 명시(§3.2 신설 상태, §3.8).
8. 스키마 필드명을 A3/마스터에 맞춤: Tasks Delegated 필터 `owner='agent_runtime'` → `owner_kind='agent'` + `tasks.kind` 언급(§3.5), PersonCard 관계 상태 dot에 `warming` 포함 전체 enum 반영(§3.6).

**반영 안 됨**: 없음(8건 전부 적용).

**새로 열린 항목**: 없음 — 이번 패스에서 추가한 명세(라벨 칩 색, Hermes 배지, 통합 검색 그룹)는 모두 마스터 §3/§6/§9 또는 A3 DDL에서 직접 확인된 사실 기반이며, 통합 검색의 정확한 지연/디바운스 수치 하나만 §2.5 본문에 **UNVERIFIED — spike**로 표시했다(신규 열린 리뷰 항목이 아니라 같은 절 안에 스파이크로 명시).

### v1.0 (2026-09-20, pass 2)

전역 리뷰 pass 2 `99-review-v2.md`(§2-4, §4-1, §4-5)를 반영해 아래 3건을 고쳤다.

1. **§3.6 팔로업 큐 데이터 바인딩**: 존재하지 않는 `threads.person_id`를 참조하던 쿼리를 A3 v0.95가 신설한 `persons.primary_thread_id`로 역방향 조인하도록 재작성(`persons.where(id IN followUpCandidateIds).related('primaryThread', ...)`). "리뷰 노트"의 남은 미해결 항목(`thread.person_id` 필드 없음)도 함께 닫아 해당 절에서 제거(99-review-v2 §2-4).
2. **§2.5 통합 검색**: 클라이언트가 `items.search_tsv`/trigram 인덱스/`search_memory` tool을 직접 소비한다고 적었던 부분을 전부 걷어내고, A4 §14 `GET /search`가 반환하는 `SearchResponse` 하나만 소비하도록 재작성(`search_tsv`는 A3 §7에서 Zero 복제 제외 대상). 결과 그룹 순서를 A4 §14.4 스키마와 일치시켜 `people → threads → items → memories`로 정정(기존 `threads/items/people/memories`는 스키마와 달랐음), 인덱스명을 A4 §14.2 표기(`items_body_trgm_idx`)로 정정. "지연 목표치가 어디에도 없다"는 서술을 삭제하고 A4 §14.5/S-A4-7의 실제 UNVERIFIED 목표치(180ms 디바운스, items/threads/people p95 ≤ 400ms, memories ≤ 1.2s)로 교체(99-review-v2 §4-5).
3. **§4.4 Web Push**: Digest 진입 푸시 1종은 유지하되, 초안 알림에 A4 §3.6의 3등급(즉시/묶음/무음)을 명시적으로 이식 — 즉시 푸시 카드(80자 미리보기 + **Approve/Open** 액션, A4 §3.6 원문 그대로)와 묶음 푸시 문구("초안 {N}건 준비됨", 09/12/15/18 KST)를 신설하고 전역 조용시간 규칙을 인용. 하단 탭바는 Inbox/Today/Tasks/Network/Notes 5개로 변경 없음(99-review-v2 §4-1).

**반영 안 됨**: 없음(3건 전부 적용). 단, 작업 지시의 버튼 문구 "Approve/Snooze"는 그대로 쓰지 않았다 — A4 §3.6·마스터 §12·99-review-v2 §4-1 전부 즉시 푸시 액션을 "Approve/Open"으로만 정의하고 "Snooze"를 푸시 액션 버튼으로 쓴 근거가 어디에도 없어, 사실 추적 원칙에 따라 **Approve/Open**으로 스펙했다.

**새로 열린 항목**: 없음 — 이번 패스의 수정은 전부 마스터 v1.0·A3 v0.95·A4의 기존 확정 사실(§14 SearchResponse 스키마, §3.6 알림 3등급, `persons.primary_thread_id`)을 그대로 옮긴 것이며 새 UNVERIFIED 항목을 만들지 않았다. §2.5의 지연/디바운스 수치는 기존에 A4가 이미 연 S-A4-7 스파이크를 인용한 것으로, A5 단독의 새 오픈 항목이 아니다.
