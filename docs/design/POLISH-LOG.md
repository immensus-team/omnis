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

## US-D02 리뷰 3회차 — 한 상태는 한 색, 위가 말한 건 아래가 되풀이하지 않는다 (2026-09-21)

2회차 거절은 픽셀이 아니라 **화면이 같은 말을 두 번 한 것**에 대한 거절이었다. 공통 원인이
하나라 하나씩 고치지 않고 규칙으로 고쳤다: *상태는 화면에서 딱 한 곳이 말한다.*

1. **blocked는 한 색이다.** 같은 "확인 필요"가 그룹 헤더에선 빨강(`tone="danger"`),
   700px 옆 행 배지에선 파랑(`--accent`)이었다 — `agents-density.png`에 그대로 찍혀 있었다.
   2회차는 두 표면의 **라벨**만 맞추고 색은 각자 두면서, 정작 "같은 상태를 두 문구로 보여주면
   안 된다"는 주석을 달았다. 이제 tone을 `warning`으로 고정하고(blocked는 "내 차례"지 에러가
   아니다 — 에러는 `failed`고, 이 저장소가 이미 "네 차례"에 쓰는 색은 `--warn-500`이다:
   `.inbox-row__approval-dot`) `app.css`가 **선택자 두 개에 값 한 벌**을 준다. 규칙이 하나면
   갈라질 수가 없다.
2. **그룹 안의 행은 헤더의 상태어를 반복하지 않는다.** agents 뷰가 "확인 필요 / 확인 필요 /
   작업 중 / 작업 중"으로 읽혔다(레퍼런스는 상태어를 헤더에만 둔다). 그룹일 때 행 배지를 끄고
   비는 우측 슬롯은 채널 글리프가 가진다 — **헤더는 상태, 행은 채널**.
3. **호버 카드의 트리거 행에 hover 상태를 줬다.** 400ms 카드가 이 태스크의 핵심 인터랙션인데
   `.inbox-row:hover`에 배경이 없어 `row-hover-card.png`에서 카드가 아무 데도 안 붙어 떠
   있었다(슬롭 카탈로그 K7). 채움은 이 화면의 다른 5곳과 같은 `--state-hover`, 반경은 선택 행
   카드와 같은 8px다(가리켰다가 고르는 동안 행 모양이 바뀌면 안 된다 — 구분은 모양이 아니라
   채움이 한다). 선택된 행은 이미 흰 카드로 떠 있어 회색을 덧대지 않는다.
4. **needs-approval의 그룹 헤더를 뺐다.** 이 뷰는 `pending_approvals`를
   `.where("state","=","pending")`로만 쿼리해서 그룹이 **언제나 하나**다 — 헤더 띠가 방금 고른
   탭 이름을 한 번 더 말할 뿐 정보를 싣지 못했다(`approvals-density.png`의 "● 대기 6" 띠).
   숫자만 탭 pill 안으로 접었다.
5. **도달할 수 없는 라이프사이클 코드를 지웠다.** `approvalPillState`의 5개 분기,
   `APPROVAL_GROUP_ORDER` 6항목, `ApprovalStatusPill` 6상태 — 전부 위 쿼리가 만들 수 없는
   값이었다. 2회차 기록이 "라이프사이클 뷰가 생기면 거기서 산다"고 써 놓고 코드는 여기 남겨
   뒀던 것이다. 그 뷰가 생길 때 거기서 만든다.
6. **그 코드를 지킨다고 믿던 테스트가 실은 아무것도 막지 못했다.** `inbox-grouping.test.tsx`의
   목 프록시가 `.where()`를 버려서, 프로덕션 쿼리가 절대 만들 수 없는 행(executed/expired/failed)을
   화면에 먹이고 그 위에서 그룹이 여럿 나온다고 단언하고 있었다. 목이 이제 `=`/`!=`를 실제로
   적용하고, 모르는 연산자는 던진다(조용히 새지 않게).
7. **죽은 표면 제거.** `.status-pill__count` CSS(2회차에 카운트를 헤더로 옮기며 고아가 됨),
   `StatusPill.icon`/`dot`, `GroupHeader.onAdd`와 `.group-header__add`. `shots.ts`의
   "1회성 스크립트(커밋하지 않는다)" 주석은 파일이 커밋돼 있으므로 사실에 맞게 고쳤다 —
   이 저장소는 주석을 설계 기록으로 쓴다(2회차 7번과 같은 이유).

### 실사용 테스트에서 추가로 나온 것

화면을 실제로 써 보며(탭 전환 → 라벨 필터 → 호버) 찾은 둘. 둘 다 위 규칙의 같은 적용이다.

8. **needs-approval에서 행마다 붙던 승인 대기 점을 껐다.** 그 탭에서는 **모든** 행이 승인
   대기라 점이 아무것도 구분하지 못한다 — 탭 pill이 이미 말한 상태다(3번과 같은 규칙:
   위가 말한 걸 아래가 되풀이하지 않는다). 다른 탭에서는 "이 행만 내 결정을 기다린다"는 뜻이
   살아 있어 그대로 둔다.
9. **필터 팝오버 placeholder가 한국어 UI 한가운데 영어였다**(`"Filter…"`). 필드명을 물려받아
   `라벨 검색`이 된다.

### 이번 라운드에 의도적으로 **안** 한 것

- **그룹 헤더의 "+"** (브리프 (2)의 일부). omnis에는 "이 상태로 세션을 새로 만든다"는 흐름이
  없어서, 그리면 눌러도 아무 일이 없는 죽은 어포던스가 된다. 2회차는 `onAdd` prop만 만들고
  앱에서는 안 써서 "미배달 + 미테스트 표면"이 됐다 — 이번엔 prop째 지웠다. 세션 생성 흐름이
  생기는 날 헤더에 다시 넣는다.
- **`AgentStatusPill.failed`** — `agent_sessions.state`에서 독립적으로 오는 값이 아니다
  (`row-meta.ts`의 DB 매핑이 failed를 blocked로 접는다). 타입에는 있고 앱 경로는 없다.

### 증거

`tools/e2e/shots.ts`로 4장 다시 찍었다. 상태당 세션을 2건 이상으로 늘렸다 — 그룹 카운트가 전부
1이면 "밀도 시스템"이 아니라 헤더 네 줄만 보인다.

- `screens/agents-density.png` — 확인 필요 2 → 작업 중 2 → 대기 2 → 완료 2. 상태어는 헤더에만,
  행 우측은 전부 채널 글리프. 헤더 pill의 앰버가 (같은 화면 `all` 탭의) 행 배지 앰버와 같은 값이다.
- `screens/approvals-density.png` — 헤더 띠 없음, 탭이 `needs-approval 6`, 행에 중복 점 없음.
- `screens/filter-chips.png` — `라벨은 2개 중 하나 ×` + 팝오버 ✓ 2개, 탭 카운트가 칩 범위를 따라간다.
- `screens/row-hover-card.png` — 호버한 행에 회색 채움, 카드가 그 행에 붙어 나온다.

`pnpm lint` / `pnpm typecheck` 통과, `pnpm test` 584 passed / 2 skipped,
`pnpm e2e:phase-a` 2패스 38/38 PASS.

## US-D02 4회차 — 행 grid 충돌과 "증거가 아닌 증거"

3회차 거절의 핵심은 pill 시스템이 아니라 **행 레이아웃이 겹쳐 그려지고 있었다**는 것,
그리고 그 겹침을 못 잡는 스크립트를 겹침이 없다는 증거로 인용했다는 것이다.

1. **`.inbox-row__summary-line`이 `grid-column: 2 / span 2`로 우측 슬롯 칸을 침범했다.**
   `.inbox-row__side`는 `grid-row: 1 / span 2` + 세로 가운데 정렬이라 **아래 절반이 정확히
   라벨 칩 줄 위에 내려앉는다.** 그래서 `#omnis-launch`의 Slack 마크가 `launch` 칩을,
   `PoC slides`/`omnis launch sync`의 Gmail 마크가 `personal`/`launch` 칩을 깔고 앉았다 —
   3회차가 자기 증거로 커밋한 스크린샷 4장 중 3장에 그대로 찍혀 있었다. US-A33(0354512)부터
   깨져 있었고 고치는 건 한 줄이다: 칩은 col 2에서 끝낸다.
2. **`shots.ts`의 "overflow 0px"는 이 겹침에 대해 아무 말도 안 한다.** 페이지 가로 스크롤
   (`scrollWidth - clientWidth`)은 행 **안에서** grid 아이템 둘이 같은 칸을 차지하는 걸 볼 수
   없다 — 그래서 "세 폭 모두 0px"가 참이면서 동시에 무의미했다. 이제 폭마다 렌더된 모든 행의
   `.inbox-row__chips`와 `.inbox-row__side` **실제 bounding box 교집합**을 잰다.
   *이 검사는 실제로 실패한다는 걸 확인했다*: CSS를 옛 `2 / span 2`로 되돌리면
   `1024px에서 #omnis-launch (75.0x6.0px), PoC slides (75.0x7.0px), omnis launch sync (55.4x6.0px)`로
   던진다 — 거절이 지목한 바로 그 3행이다.
3. **`agentState={grouped ? null : …}`를 되돌렸다.** 그룹 뷰에서 상태를 null로 덮으니 런타임
   세션 행이 채널 글리프로 떨어져 스크린리더에 "Slack 메시지"라고 자칭했다. 세션이라는 사실은
   `agentState` 하나에 살고, "헤더가 이미 상태를 말한다"는 건 새 `groupedByState` prop이 말한다 —
   그룹일 때 세션 행의 우측 슬롯은 **빈다**(무관한 아이콘으로 메우지 않는다).
4. **`라벨은 1개 중 하나` → `라벨은 Integrations`.** 레퍼런스 DSL도 값이 하나면 수량사를
   접는다("Channel is Slack"). 2개부터만 개수 문법을 쓴다.
5. **칩 × 버튼 17x17 → 24x24.** 칩 자체는 안 키운다. 실측으로 확인했다: `margin: -3px 0` 없이는
   칩이 26px → 32px로 자라고, 있으면 26px 그대로에 버튼 박스만 24x24다.
6. **틴트 문법을 하나로.** `.filter-chip`이 `color-mix(in oklch, …)`를 쓰고 있었는데, 스무 줄 위
   `.status-pill` 주석이 바로 그 함수가 hue를 `--bg-elevated`의 h260 쪽으로 돌린다고 설명해
   놓은 상태였다. 한 파일에 같은 일을 하는 틴트 공식이 둘이고 그중 하나는 문서상 틀린 것으로
   남아 있었다 — `oklch(from …)`으로 통일했다.

### 반경(radius)에 대한 메모

한 화면에 999px / 12px / 8px / 6px / 4px / 30%가 공존한다. 각각 이유가 주석에 달려 있고
균일-반경 텔의 반대편이라 그대로 두지만, **명시된 스케일이 없어서 다음 사람이 반올림할 데가
없다** — `DESIGN-DIRECTION.md`에 한 줄로 적어 둔다.

### 증거

`pnpm lint` / `pnpm typecheck` 통과, `pnpm test` 110 files / 586 passed / 2 skipped
(3회차 584 + InboxRow `groupedByState` 2건). `tools/e2e/shots.ts`로 4장 다시 찍었고
세 폭 전부 `overflow 0px, 12개 행 중 칩/우측슬롯 겹침 0건`.
`pnpm e2e:phase-a`는 공유 포트(5173/8787/4848)를 `resetDatabase()`/`assertPortsFree()`로
잡기 때문에 다른 체인을 방해하지 않으려고 돌리지 않았다 — `shots.ts`가 같은 스택을 올린다.
