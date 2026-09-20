# P1 kinso polish — 2026-09-20

기준: `reference/kinso-inbox.webp`. 전/후 비교는 git에서 `docs/design/screens/inbox-kinso.png`를 보면 된다
(이 커밋에서 Playwright e2e 시드로 새로 찍음).

## 바꾼 것

1. **브랜드 컬러 아이콘** (`packages/ui/src/lib/row-meta.ts` `CHANNEL_COLOR`,
   `packages/ui/src/components/channel-glyph.tsx` 신설): 레일 타일과 행 우측 아이콘이 전부 회색이던 걸
   각 채널의 브랜드 hex로 칠한다(Slack #4A154B, LinkedIn #0A66C2, WhatsApp #25D366, Telegram #26A5E4,
   Outlook #0078D4 — 태스크 지정값 그대로; Gmail/Google Calendar는 태스크에 hex 지정이 없어 구글 공개
   팔레트로 근사: EA4335 / 4285F4). react-icons는 진짜 멀티톤 마크를 안 준다(심플아이콘 소스가 단색
   path 1개) — 그래서 대부분 "컬러 단색 글리프", kinso의 "일부는 화이트 타일+컬러 글리프"에 해당한다.
   KakaoTalk만 태스크 스펙대로 예외(`CHANNEL_TILE_BG`): 브랜드 옐로 #FFE812 타일 위에 검정 글리프 —
   channel-rail.tsx와 inbox-row.tsx가 같은 `ChannelGlyph` 컴포넌트를 공유해서 로직이 한 곳이다.
2. **Agents 레일 타일**: sparkle을 `var(--accent)`로 칠했다(CHANNEL_COLOR.agent). Inbox 타일(검정+흰
   글리프)·44px 스쿼클·흰 플레이트+섀도는 이미 U1에서 맞아 있어 손대지 않았다.
3. **에이전트 세션 아바타 런타임 로고**: Claude Code는 `SiClaudecode`(터미널 로고) 대신 태스크가 명시한
   진짜 Anthropic 마크(`SiAnthropic`, react-icons/si)로 바꿨다. Hermes는 브랜드 마크가 없어(이 버전의
   simple-icons에 없음) 사람 아바타 이니셜 폴백과 같은 패턴으로 글자 "H" 하나를 보여준다
   (`RUNTIME_LETTER`, row-meta.ts). Codex는 OpenAI 마크가 이 react-icons 버전에 없어 기존 lucide
   `Bot` 아이콘을 그대로 뒀다(핸드드로우 SVG를 새로 만들지 않는다는 원칙 유지) — OpenAI 로고가
   패키지에 들어오면 `RUNTIME_ICON.codex`만 바꾸면 된다. 런타임 아바타 타일도 사람 원형 아바타와
   구분되게 스쿼클(30%)로 바꿨다.
4. **행 레이아웃**: 시간을 행 끝까지 미는 `margin-left: auto`를 지웠다 — kinso는 시간을 이름 바로
   옆에 붙인다("Natasha Corwin 3m"); 지금은 "#omnis-launch • now"처럼 이름 줄에 바로 붙는다. 이름은
   15px semibold(600, unread는 700)로 — 이전엔 읽은 행이 400(레귤러)이라 kinso보다 훨씬 가늘었다.
   요약은 이미 14px + `var(--text-secondary)`라 손 안 댔다.
5. **선택 행 카드**: 라운드를 14px → 8px로(다른 카드류가 20px/22px인데 행만 유독 컸다). 행 패딩을
   14px → 12px로(태스크가 명시한 "12px 세로 리듬").
6. **상태 배지 soft pill**: 라벨 칩(윤곽선 pill)과 같이 묶여 있던 `.status-badge`를 분리해 테두리 대신
   옅은 채움 배경(`--bg-elevated`)으로 — "soft pill". blocked만 accent 톤 배경+텍스트로 강조(기존
   `--warn-500` 주황 대신 — herdr 4상태 중 "내가 봐야 함" 신호를 라벨 칩과 다른 색으로 분리).

## 여전히 다른 것 (정직하게)

- **아바타가 원형 사진이 아니라 이니셜/이모지**: 시드 데이터에 사람 사진 URL이 없어(`RowAvatar`는
  photo 케이스를 이미 지원하지만 아직 아무 데도 안 채운다) kinso처럼 실제 얼굴 사진이 뜨는 행이 하나도
  없다. 이건 데이터 문제지 이번 폴리시(레이아웃/컬러) 범위가 아니다.
- **에이전트 세션 아바타가 이니셜로 폴백하는 행이 있다**: 시드의 `agent_sessions`가 `agent_runtimes`와
  안 붙는 조합이 있으면 `Inbox.tsx`가 `{kind:"runtime"}` 대신 `{kind:"initials", name:title}`로
  떨어진다(U2 때부터 있던 폴백, 이번에 손 안 댐) — "claude_code · inbox-draft" 행은 이번 시드에서는
  제대로 Anthropic 마크가 뜨는 걸 스크린샷으로 확인했다.
- **라벨 칩은 여전히 윤곽선 pill**(soft pill 아님) — 태스크가 soft pill을 명시한 건 상태 배지뿐이라
  칩은 그대로 뒀다. kinso 자체엔 라벨 칩이 없어(레퍼런스 이미지에 없음) 정답이 kinso에 없다.
- **Gmail/GCal 브랜드 컬러는 근사치**: 태스크 문서가 hex를 안 줘서 구글 공개 팔레트로 추정했다
  (row-meta.ts의 `ponytail:` 주석 참고) — 정확한 값이 중요해지면 그 한 줄만 바꾸면 된다.
- **진짜 "멀티톤" 브랜드 마크는 하나도 없다**: react-icons(simple-icons 소스)가 브랜드당 SVG path
  1개 + 단색이라, kinso 레퍼런스의 진짜 4색 Gmail 로고 같은 건 이 라이브러리로는 못 낸다. 태스크가
  허용한 대로(멀티톤이 없으면 단색 글리프) 처리했다 — 새 SVG를 손으로 그리진 않았다.

## US-D01 재작업 — 유리 위 위계·포커스 스트로크·플로팅 패널 (2026-09-20, attempt 2)

리뷰가 잡은 블로킹 5건을 근본 원인에서 고쳤다. 스크린샷: `screens/inbox-glass.png`,
`screens/ai-panel.png`, `screens/ai-panel-commands.png`.

1. **유리 위의 상태는 밝히는 게 아니라 어둡게 한다.** 새로 넣은 상태 레이어가 전부
   `color-mix(in oklch, var(--bg-base) N%, transparent)`였다 — 유리(`--bg-overlay` = `--gray-000`
   78%, L≈0.988) 위에 L 0.99를 얹은 것이라 명도차가 0.15%, 즉 안 보였다(선택 탭·호버·요약 배경
   전부). 채움은 `--bg-elevated`(L 0.97, 약 12배 대비), 호버는 새 토큰 `--state-hover`
   (`color-mix(in oklch, var(--text-primary) 6%, transparent)`)로 통일했다. `--state-hover`를
   토큰으로 올린 이유: 같은 값이 5곳에 필요했고, 텍스트색 기반이라 다크에서도 한 줄로 뒤집힌다.
   이미 있던 `[cmdk-item][data-selected]`도 `--bg-elevated`를 쓰고 있어 결이 맞는다.
2. **포커스 그라데이션이 스트로크로 돌아왔다.** "padding-box 채움 + border-box 그라데이션" 2겹
   트릭은 채움이 불투명할 때만 성립한다 — 채움을 유리(78%)로 바꾼 순간 border-box 레이어가 22%
   비쳐 그라데이션이 1.5px 테두리가 아니라 ~820px 필 전체를 물들였다(anti-slop #3 장식 그라데이션).
   채움은 `.glass-surface`에 그대로 맡기고, 스트로크는 마스크로 안쪽을 도려낸 `::after` 링 하나가
   전담한다. `border-image`는 `border-radius`를 못 따라가고 `outline`은 그라데이션을 못 받아서
   둥근 필에 남는 방법이 이것뿐이다.
3. **타이핑이 막다른 길이 아니다.** 패널이 항상 "제안" 탭에서 열리고 `Command.List`는 "명령"
   탭에서만 렌더돼서, 바에 타이핑하면 cmdk가 필터링은 하는데 화면엔 아무것도 안 나왔다(US-D01 이전
   인라인 팔레트의 회귀). 탭을 입력에서 파생시켰다: 빈 입력=제안, 비면 아닌 입력=명령(">"도 여기
   걸린다), 탭을 직접 누르면 그 선택이 다음 타이핑까지 유지된다. 회귀 테스트 3개 추가.
4. **비활성 신호 바닥은 0.55다**(hallmark slop-test:111). 0.42/0.40이던 Phase B 액션과 첨부
   버튼을 0.55로 올리고, 행 오른쪽 끝에 "Phase B" 태그를 붙였다 — 왜 못 누르는지가 보인다.
5. **패널 비례.** 바 전체 폭(~820px)으로 늘어난 4.4:1 빈 밴드를 420px 카드로 좁혀 오브 아래에
   앵커시키고, 레퍼런스의 대화 영역 자리에 실제 컨텍스트(스레드 제목 + 상태/요약)를 넣었다.
   `transform-origin`도 `top center` → `top left`로 옮겨 앵커와 맞췄다.
6. **닫기도 스프링이다.** `{open && <AskPanel/>}`은 동기 언마운트라 240ms 등장만 있고 퇴장은 하드
   컷이었다. `useClosingSpring`이 `--dur-panel` 동안 패널을 DOM에 붙들고 `.ask-panel--closing`이
   등장 경로를 그대로 뒤집어 재생한다(apple-design §7 spatial consistency). reduced-motion에서는
   `--dur-panel`이 0ms라 JS 타이머도 `matchMedia`로 0으로 맞춘다.
7. **@ 는 상시 버튼이다.** 이전엔 `query.includes("@")`일 때만 칩이 나타나서, 이미 "@"를 칠 줄
   아는 사람에게만 보이는 어포던스였다(아무것도 못 가르친다). 레퍼런스처럼 첨부 아이콘 옆에 상시
   버튼을 두고, 누르면 입력에 "@"를 꽂는다. 칩은 그 위에 그대로 뜬다.

### 검증 메모

- **anti-slop #11(모바일 4사이즈 가로 스크롤)은 이 셸에 해당하지 않는다.** 실측했다:
  320/375/414px에서는 가로 스크롤이 나고 ask 바 입력이 0폭으로 접힌다. 다만
  `apps/desktop/src-tauri/tauri.conf.json`이 `minWidth: 1024`라 그 폭에 도달할 수 없다.
  실제 도달 가능한 1024/1280/1440px에서는(상세 패널 연 가장 넓은 레이아웃) 가로 스크롤 없음을
  Playwright로 확인했다. 웹 배포(`@omnis/web`)가 이 셸을 쓰게 되면 그때 다시 봐야 한다.
- `biome.jsonc`에 `.claude/skills/**`를 ignore로 넣었다 — 벤더링한 OSS 스킬의 tsconfig 템플릿과
  픽스처가 `pnpm lint`를 136개 에러로 막고 있었다(353f0a7부터, 이 스토리와 무관한 선행 문제).
- **⌘K 경로가 깨져 있었다(이 브랜치가 들여온 회귀, e2e가 잡았다).** US-D01이 ⌘K를 모달 팔레트에서
  ask 패널로 옮기면서 `tools/e2e/phase-a.spec.ts`의 A9(모달 placeholder "검색 또는 명령…")는 그대로
  둬서 실패했고, 더 나쁘게는 ⌘K가 패널을 열기만 하고 입력에 포커스를 주지 않아 Escape도 타이핑도
  안 먹었다(패널이 열린 채 목록 클릭을 막아 A-archive/G5까지 연쇄 실패). 열릴 때 입력을 포커스하고
  (`onFocus`는 이미 열려 있으면 상태를 다시 건드리지 않는다), A9을 새 표면 기준으로 다시 썼다:
  ⌘K → AI 패널 → 타이핑 → 명령 목록 → Escape로 닫힘. `pnpm e2e:phase-a` 2패스 38/38 PASS.

## US-D02 리뷰 2회차 — pill/밀도 시스템 (2026-09-21)

리뷰어가 거절한 항목을 제품 의미부터 되돌린 패스. 픽셀보다 "화면이 하는 말"이 틀렸던 게 많았다.

1. **needs-approval 탭은 다시 액션 큐다.** 1회차는 그룹 헤더를 여러 개 띄우려고 이 탭을
   `approvalState !== null`(승인 활동이 있었던 스레드 전부)로 넓혔다 — 결정·만료된 건이 영영
   남는 승인 아카이브가 되고, 이름은 그대로 "needs-approval"이었다. `hasPendingApproval`로
   되돌렸다. 라이프사이클 그룹은 라이프사이클을 다루는 뷰가 생길 때 거기서 산다
   (`groupByApprovalState`는 그 순서를 들고 있고 순수 함수 테스트로 고정돼 있다).
2. **승인한 건의 실행 실패를 "거절됨"이라고 쓰지 않는다.** `state='failed' + decision='accept'`
   (migrations/0004)를 거절 버킷에 접으면 사용자가 하지 않은 행동을 했다고 말하게 된다. 표시
   상태에 `failed`(실패)와 `responded`(역제안 — `allow_respond`는 거절이 아닌 별도 선택지)를
   더했다.
3. **호버 카드는 행이 잘라 낸 것만 말한다.** 1회차 카드의 "참여자"는 값이 카드 제목과 같은
   문자열이었다(= 자기 제목을 되풀이하는 패널, 스펙 한 줄을 채우려고 만든 컴포넌트의 전형).
   참여자 모델이 없으니 그 줄을 지우고, 행이 한 줄 ellipsis로 자르는 **요약 전문**과 칩 2개
   +N에서 잘린 **전체 라벨**, 점 하나로 줄어든 **안읽음 수**, 채널명을 담는다.
4. **카운트를 pill 밖으로 꺼냈다.** 탭 pill 줄 / 필터 칩 줄 / 그룹 헤더가 거의 같은 크기의 작은
   칩 세 줄로 쌓여 헤더가 "네 번째 필터"로 읽혔다. 레퍼런스(ref-issue-tracker-density.webp)는
   상태 pill 옆에 **별도 회색 칩**으로 숫자를 두고 그 뒤에 +를 놓는다 — 그 문법으로 바꾸고 헤더
   위 여백을 행 간격보다 키웠다. `StatusPill`에서 `count` prop을 삭제했다(두 군데서 숫자를
   그릴 방법이 있으면 결국 둘 다 쓰인다).
5. **칩 문구를 한국어로 통일.** `Label is any of 2개 라벨`은 레퍼런스의 영어 필터 DSL에 한국어
   명사를 붙인 혼종이었다. `라벨은 2개 중 하나` / `채널은 Slack`.
6. **`pending_approvals` 쿼리에 상한을 되돌렸다.** 1회차가 `.where(state,pending)`를 떼면서
   클라이언트가 모든 승인 이력을 무제한 복제하고 있었다. 이름대로 pending만, `created_at desc`
   + `limit(200)`(바로 위 items 쿼리와 같은 상한).
7. **잘못된 설계 기록을 고쳤다.** `app.css`의 두 주석이 같은 레퍼런스를 인용하며 정반대를
   말했고(`상태 pill = 라운드 렉트` vs `= 캡슐`), 레퍼런스 실물은 상태 pill이 캡슐·필터 칩이
   테두리 있는 라운드 렉트다. 12px 반경은 레퍼런스가 아니라 브리프의 실측 지정이라는 것도
   주석에 적었다 — 이 저장소는 주석을 설계 기록으로 쓴다.
8. **a11y.** 그룹 헤더가 Virtuoso의 `role="listbox"` 안에 행과 섞여 들어가므로
   `role="presentation"`을 줬다(AT가 헤더까지 옵션으로 세지 않게). 새로 만든 컨트롤 3개에
   `:focus-visible`/`:active`를 붙였다(hallmark gate 26).

### 증거

`tools/e2e/shots.ts`(1회성 캡처 스크립트, e2e 스택 + seed 위에 밀도만 더한다)로 다시 찍었다.
1회차 스크린샷은 pill 하나 · 행 하나 · 빈 흰 공간 600px이라 "밀도 시스템"을 증명하지 못했다.

- `screens/approvals-density.png` — 대기 6건, pill + 별도 카운트 칩 + 밀도 있는 행들.
- `screens/agents-density.png` (신규) — 확인 필요 → 작업 중 → 대기 → 완료 4그룹. 그룹 **순서**가
  실제로 보이는 화면은 여기다(`inbox-grouping.test.tsx`가 단언하는 그 순서).
- `screens/filter-chips.png` — 라벨 2개를 실제로 고른 뒤: 칩 `라벨은 2개 중 하나 ×` + 팝오버의 ✓ 2개.
- `screens/row-hover-card.png` — 행에서 `…`로 잘린 요약 전문 + 라벨 3개(행은 2 + `+1`) + 채널 +
  안읽음 2개.

`pnpm e2e:phase-a` 2패스 38/38 PASS(새 호버 카드가 행마다 포털을 다는데도 회귀 없음).
