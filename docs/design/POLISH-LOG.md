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
