# GAP 4: Kinso 스크린샷 기반 실사 티어다운 (2026-09-20 리서치)

원본 스크린샷/mockup 이미지는 `omnis/research/assets/kinso-teardown-2026-09-20/`에 저장(hero-desktop.png, hero-mobile.png, morning-briefing-dark.png, integration-icons.png, notif-card-*.png — 전부 kinso.ai 공식 CDN(framerusercontent.com)에서 2026-09-20 직접 다운로드).

## 1. TL;DR

텍스트 fetch로는 못 봤던 kinso.ai의 실제 UI를 브라우저+DOM 인스펙션(이미지 URL 직접 추출, `getComputedStyle`)으로 실사했다. 확인된 핵심: (1) 리스트 행은 원형 아바타+굵은 이름+회색 타임스탬프+회색 프리뷰 1줄+우측 채널 브랜드 아이콘 구조, 선택된 행만 흰 카드가 배경에서 살짝 뜬 elevation(soft shadow)으로 구분—헤어라인 구분선은 안 씀. (2) 다크 **모드**는 없음(color-scheme 메타·dark class 전무, DOM으로 확인)이지만 다크 **섹션**(모닝 브리핑, 음성 기능)은 존재—그리드 텍스처+오렌지→틸 그라디언트 오브 액센트. (3) 검색바/입력창은 전부 pill(full-radius), 포커스 시 오렌지-틸 그라디언트 stroke. (4) 로고·액센트 컬러 실측: 틸 `#497E7E`→라이트그레이`#E7EAED`→오렌지`#EF5520`→러스트`#9F2B04`. (5) 채널 목록이 1차 소스에서 공식 확정됨(Gmail·LinkedIn·Slack·WhatsApp·Instagram). (6) 네이티브 앱 증거는 이번에도 전무(모든 CTA가 "Join"/"Waitlist"뿐, App Store 링크 없음)—omnis의 "웹 우선 vs 네이티브" 결정에 참고할 유일한 근거는 "안 만들었다"는 부재 증거뿐이다. (7) waitlist 숫자가 페이지 로드마다 달라짐(27,300→24,566→32,754)—신뢰 불가 확정. (8) Instagram 게시물 캡션에 "1,000명 온보딩" 언급, YouTube에 "We Failed To Launch...(kinda)" 영상 존재—대기자 수 대비 실사용자는 훨씬 적고 런칭이 순탄치 않았을 가능성.

## 2. Facts

**레이아웃/그리드**
- 데스크톱 히어로 mockup(`3Kfz1cxtmXzOANwMwOvBEIqKkc.png`, 5236×3667 원본)은 macOS 트래픽라이트 점(빨강/노랑/초록, 좌상단)이 있는 브라우저/앱 창 프레임 안에 인박스 UI를 담고 있다—Kinso 자신도 "Mac 앱처럼 보이는" 프레이밍을 마케팅에 쓴다는 뜻(실제 네이티브 앱 여부와는 별개). VERIFIED(이미지 직접 확인) — [kinso.ai 히어로 이미지](https://framerusercontent.com/images/3Kfz1cxtmXzOANwMwOvBEIqKkc.png) (2026-09-20).
- 좌측 아이콘 레일: 다크 사각(squircle) "Inbox" 아이콘(검정 bg, 흰 인박스 심볼)이 최상단에 고정, 그 아래 Gmail/Instagram/LinkedIn/Slack/WhatsApp/Teams/Outlook 순으로 컬러 브랜드 아이콘, 맨 아래 chevron(더보기)—채널마다 개별 사이드바 아이콘, 카테고리 그룹화 없음. VERIFIED.
- 리스트 행: 원형 아바타(사진), **이름(bold, ~20px 추정) + 타임스탬프(회색, 소형, 같은 줄 우측)**, 그 아래 프리뷰 텍스트(회색, 1줄, ellipsis 없이 잘림), 행 맨 우측에 컬러 브랜드 아이콘(발신 채널 표시). VERIFIED.
- **채널 정체성 표시 방식= 아이콘, 색상 아님.** 아바타는 항상 인물 사진(회색조 아님)이고 행 배경색도 채널별로 안 바뀜—오직 우측 끝 작은 브랜드 로고 아이콘으로만 Gmail/LinkedIn/Slack/WhatsApp을 구분한다. VERIFIED.
- Elevation 처리: 리스트 중 "선택/포커스" 상태인 한 행(Natasha Corwin)만 흰색 배경 카드가 나머지 리스트보다 살짝 앞으로 떠 있고 부드러운 그림자(soft shadow, blur 큼·offset 작음)가 진다. 나머지 행은 옅은 회색(off-white) 배경 위에 얹혀 있을 뿐 카드화되지 않고, 행 사이 hairline 구분선도 안 보인다—밀도는 간격(padding)만으로 관리. VERIFIED.
- 컨텍스트 알림 카드(우상단 3개 플로팅 카드, `9yY4fbqNQx6EXMLJAq5LWw9t0.jpg` 배경 위): 각 카드는 옅은 회색 bg, 큰 corner radius(~16-20px 추정), 좌상단에 컬러 브랜드 아이콘, 우상단에 **점선(dashed) 원형 unread 인디케이터**—채워지지 않은 원은 읽음/안읽음 상태 토글로 추정되는 독특한 UI 디테일. VERIFIED(개별 카드 이미지 `fx3BQ9tj...`, `pdnVm6k5...` 직접 확인).
- 검색/입력 필드는 전부 **pill(완전 둥근 모서리)**: 데스크톱 "Start typing to ask or search Kinso", 모바일 "Ask Kinso" 둘 다 full-radius, 얇은 오렌지→틸 그라디언트 stroke 테두리(포커스/브랜드 상태로 추정), 좌측에 작은 원형 브랜드 오브 아이콘. VERIFIED.
- 모바일 히어로: 상태 인사문 "Good morning, Sarah. You've got 4 new and 9 active conversations"(모닝 브리핑 카피, 헤드라인+서브텍스트 2단), 하단 탭바 5아이콘(모래시계/기록, 인박스, 중앙 원형 오렌지-틸 그라디언트 오브 FAB, 프로필, 설정)—중앙 탭이 프라이머리 액션(아마 "Ask/Briefing")으로 강조됨. VERIFIED.
- 데스크톱 모닝브리핑 mockup은 **3D 틸트(isometric-skew) 처리된 창**으로 표현(정면이 아니라 살짝 회전된 원근)—다른 기능 mockup들은 정면 플랫인데 이 섹션만 틸트를 씀, 배경은 거의 검정+그리드 텍스처. VERIFIED.

**타이포/컬러/모션**
- 로고 마크 자체가 그라디언트 벡터(추상 브래킷/꽃병 형태, 오렌지·틸 두 개의 "리본"이 교차): 실측 그라디언트 stop = `rgb(73,126,126)`(#497E7E, 틸) 0% → `rgb(34,68,72)`(#224448, 다크틸) 23.8%→24% → `rgb(231,234,237)`(#E7EAED, 라이트그레이) 45% → `rgb(239,85,32)`(#EF5520, 오렌지) 75% → `rgb(238,84,32)` 75.4% → `rgb(159,43,4)`(#9F2B04, 러스트) 100%, 각도 95deg. VERIFIED(`getComputedStyle` 직접 추출).
- 페이지 전체 배경은 옅은 웜(피치)→쿨(민트) 메시 그라디언트(라이트 모드 전용) + 미세 그리드 텍스처 오버레이. Body `background-color: rgb(255,255,255)` (JS로 직접 확인, 화이트 베이스 위에 그라디언트 레이어). VERIFIED.
- **다크 모드 없음**: `<html>` 태그에 dark class 없음, `<meta name="color-scheme">` 없음, `prefers-color-scheme`에 반응하는 CSS 확인 안 됨—즉 사이트는 **라이트 전용**이다. 대신 특정 섹션(모닝브리핑, "Unlock the power of Kinso with your voice")만 근흑색(`#0a0a0a`대) 배경+흰 텍스트+그리드 텍스처로 처리된 **콘텐츠 블록 단위의 다크 존**이지 시스템 다크모드가 아니다. VERIFIED(DOM 직접 조회, 모바일 뷰포트에서 재확인).
- 헤드라인: 볼드 산세리프, 히어로 "One inbox, every conversation." 2줄 구성, 줄마다 별도 애니메이션 등장(스크린샷상 순차 페이드 추정)—폰트 자체는 Framer 기본 시스템 폰트 스택으로 보이며 별도 웹폰트 `@font-face` 확인은 이번 조사에서 생략(범위 밖). UNVERIFIED(정확한 폰트 패밀리명).
- 섹션 eyebrow 라벨 패턴: 대문자("CONTEXTUAL ASSISTANT", "FEATURES", "UNIVERSAL SEARCH") + 얇은 rounded-full 보더 pill + 좌우로 뻗은 헤어라인 디바이더. Linear/Raycast류 SaaS 랜딩의 표준 eyebrow 패턴과 동일 계열. VERIFIED.

**기능(1차 소스로 재확인/신규 확정, `01`의 UNVERIFIED 다수를 승격)**
- 채널 목록 공식 확정: "Kinso integrates with Gmail, LinkedIn, Slack, WhatsApp & Instagram. More integrations coming soon." — **Instagram은 이제 VERIFIED**(`01`에서는 서드파티만 언급해 UNVERIFIED였음). TikTok은 언급 없음(푸터 소셜 링크에만 있음, 통합 채널 아님). VERIFIED — [kinso.ai](https://www.kinso.ai/) (2026-09-20).
- **음성 인터페이스 존재 확정(1차 소스)**: "Unlock the power of Kinso with your voice. Talk to Kinso to access your morning briefing, respond to messages and ask questions..." 섹션이 홈페이지에 실재—mockup은 마이크 아이콘 입력창 + "Kinso is speaking…" 상태 라벨 + 유저/AI 채팅 버블. `01`에서 서드파티(thisandthat.chat)만 언급해 UNVERIFIED였던 것을 VERIFIED로 승격. VERIFIED — [kinso.ai](https://www.kinso.ai/) (2026-09-20).
- 필터·단축키·자동 라벨링 기능도 1차 소스 문구로 확정: "Our inbox filters let you sift through your messages by priority, topics or contacts... keyboard shortcuts", "Kinso automatically labels every message with a relevant topic." VERIFIED.
- "Smart Contacts"류 기능도 확정: "Your summarised history with a contact across every platform... Remember every detail of the people who matter most." VERIFIED (문구상 확정, UI 스크린샷은 이번에 미확보).
- 회사 주소/연락처 신규 확인: 80 Cooper Street, Surry Hills, Sydney 2010 NSW Australia, info@kinso.ai — Sydney 기반임이 주소로 재확인(창업자 배경과 일치). VERIFIED — [kinso.ai](https://www.kinso.ai/) footer (2026-09-20).
- 구버전/병행 사이트 `kinso-site.webflow.io` 실존 확인: "© 2025 Kinso"(kinso.ai는 "© 2026")로 저작권 연도가 다름—더 오래된 iteration으로 추정. 카피 톤이 다름(기능 나열 대신 **고객 인용 테스티모니얼** 5개 + "Be First to Get Beta Access" CTA). 여기도 플랫폼(Mac/iOS/Web) 언급 없음. VERIFIED(사이트 존재·접근 확인) — [kinso-site.webflow.io](https://kinso-site.webflow.io/) (2026-09-20).
- 네이티브 앱 존재 근거 **이번에도 없음**: kinso.ai, webflow 대체 사이트, Instagram 바이오, YouTube 채널 설명 어디에도 "Download on the App Store"/"Mac App Store"/APK 링크가 없다. 모든 CTA는 "Join Now"/"Join the Waitlist" 뿐. UI mockup의 macOS 창 프레임은 **마케팅 목업의 스타일링**일 뿐 실제 배포 증거가 아님. UNVERIFIED→사실상 결론: 2026-09-20 기준 웹/waitlist 단계이며 네이티브 앱은 존재하지 않거나 최소한 공개되지 않았다.
- waitlist 카운터는 **불안정**: 같은 세션 안에서 데스크톱 로드 시 27,300, 모바일 리로드 시 24,566, 재방문 시 32,754로 매번 다른 값이 나왔다(2026-09-20, 수 분 내 3회 fetch). 실제 정적 숫자가 아니라 클라이언트 사이드 애니메이션(랜덤 지터 또는 카운트업) 연출일 가능성이 높다—`01`이 이미 "서드파티 숫자 상충"으로 UNVERIFIED 처리한 것을 1차 소스 자체 불안정성으로 재확인. VERIFIED(불안정성 자체는 직접 관찰로 확인) / UNVERIFIED(실제 waitlist 규모).

**소셜/유튜브 (신규 조사, `01`에 없던 내용)**
- Instagram `@kinso.app`: 82.5k 팔로워, 11 following, 바이오 "One inbox, every conversation. Founded by @frankgreeff_ @jacquesgreeff_"—창업자 인스타 핸들 확정. 로그인 없이 보이는 게시물 썸네일 캡션 중 하나: **"As of today, we have personally onboarded 1000 users onto Kinso"**—대기자 수만 명 대비 실제 온보딩 유저는 두 자릿수~세 자릿수 훨씬 낮은 자릿수(그 시점 기준 1,000명)였다는 뜻으로, 대기열 숫자의 신뢰도를 더 낮춘다. VERIFIED(로그인 없이 공개된 프로필 헤더+썸네일 텍스트) — [instagram.com/kinso.app](https://www.instagram.com/kinso.app/) (2026-09-20).
- YouTube `@KinsoAI`: 56.6k 구독자, 171개 영상—"build in public" 콘텐츠 마케팅에 상당한 자원을 씀(제품보다 콘텐츠가 앞서는 유형일 수 있음). 영상 제목 중 **"We Sold Our Business For $180M, Now We're Building Again (With AI)"**(90k 조회)가 창업자 자신의 채널에 존재—`01`이 Grit Daily 서드파티로만 인용했던 $180M exit을 1차 소스에 준하는 창업자 자체 채널로 승격 확인. 동시에 **"We Failed To Launch Australia's Most Viral Startup (kinda)"**(17k 조회, ~2026-05경 업로드로 추정)라는 영상도 존재—제목 자체가 런칭이 순탄치 않았음을 시사하는 직접 증거(영상 본문은 이번 조사에서 시청하지 않음, 제목/메타데이터만 확인). VERIFIED(채널/영상 제목 존재) / UNVERIFIED(영상 내용 상세) — [youtube.com/@KinsoAI](https://www.youtube.com/@KinsoAI) (2026-09-20).

## 3. 비교/측정값 요약 표

| 축 | Kinso 실측값 | 비고 |
|---|---|---|
| 코너 반경 | 검색바/입력창: full-radius(pill). 앱 창: 큰 radius(~20-24px 추정). 알림 카드: ~16-20px 추정 | 정확한 px는 CSS 미추출(이미지 기반 추정), 후속 Figma 트레이싱 필요 |
| 리스트 행 밀도 | 헤어라인 구분선 없음, 순수 padding으로 행 분리, 선택 행만 카드+shadow로 격리 | Linear/Raycast의 hairline 보더 방식과 다름—omnis에 참고할 대안 패턴 |
| 다크모드 | 없음(라이트 전용 사이트) + 콘텐츠 블록 단위 다크 섹션 2곳 | "제품에 다크모드가 있다"는 근거 없음—omnis가 다크모드를 낼 경우 참고할 실제 앱 UI가 아니라 마케팅 사이트 mockup뿐이라는 한계 |
| 액센트 컬러 | 틸 #497E7E ↔ 오렌지 #EF5520 그라디언트 (로고·보더·오브 공통) | Linear(단일 라임 액센트)/Raycast(단일 코럴)와 달리 **듀얼 그라디언트 액센트**—omnis 톤 결정에 참고 가능한 제3의 패턴 |
| 채널 정체성 표현 | 아이콘(브랜드 로고), 색상/아바타 아님 | `14`의 "채널 identity를 색으로 줄지 아이콘으로 줄지" 질문에 대한 직접 레퍼런스 답 |
| Unread 인디케이터 | 점선(dashed) 원형 아웃라인 | 흔한 solid dot과 다른 디테일, 차별화 포인트로 채택 가능 |
| 플랫폼 | 증거 없음(웹/waitlist만 확인, 네이티브 앱 부재로 잠정 결론) | omnis의 "Mac 앱 필수" 결정에 kinso는 참고가 안 됨—독자 판단 필요 |
| 실사용자 규모 신호 | waitlist 3만 안팎(불안정) vs 온보딩 "1,000명"(Instagram 자체 공개) | 대기열 규모를 벤치마크로 쓰면 안 됨 |

## 4. Recommendation for omnis

**비주얼 언어 차용은 "카드 elevation + 아이콘 기반 채널 식별 + 듀얼 그라디언트 액센트" 세 가지로 좁혀서 가져가라.** kinso의 리스트는 hairline 구분선 없이 선택 행만 뜨는 카드로 격리하는 방식이 Linear/Raycast의 hairline 기반 밀도와는 다른 축이다. omnis처럼 8개 채널(Slack/Kakao/Gmail/Outlook/Telegram/LinkedIn/WhatsApp/에이전트 세션)을 한 리스트에 섞을 거면, **채널 식별은 아바타 컬러가 아니라 우측 고정 위치의 작은 브랜드 아이콘**으로 하는 kinso식이 실제로 유리하다—아바타는 "누가 보냈는지"에, 아이콘은 "어디서 왔는지"에 전담시켜 정보 채널을 분리할 수 있다. effort **S**(디자인 결정, 구현 자체는 리스트 컴포넌트에 아이콘 슬롯 하나 추가), risk 없음.

**다크모드는 kinso한테서 배울 게 없다—독자 설계해야 한다.** kinso.ai는 시스템 다크모드가 없고, 있는 건 콘텐츠 섹션 단위의 "다크 블록" 연출뿐이다. omnis는 상시 사용하는 실제 생산성 앱이라 다크모드가 필수인데, `14`가 이미 Linear/Raycast에서 다크 토큰(`#08090a`, `#07080a` 근흑 캔버스)을 가져온 것은 유효한 선택이었고 이번 kinso 조사가 그걸 바꿀 근거는 없다. effort 해당없음(이미 `14`에서 커버), risk 없음—단 `14` §7의 "kinso 실제 화면을 Figma로 옮겨 토큰을 정밀 추출"이라는 오픈퀘스천은 **다크모드에 대해서는 애초에 답이 없다**는 걸 이 조사로 확정할 수 있으므로, `14`는 kinso를 라이트모드/레이아웃 레퍼런스로만 인용하도록 정정해야 한다.

**플랫폼 결정(Mac 네이티브 vs 웹)에서 kinso를 근거로 쓰지 마라.** kinso 자신도 아직 아무것도 배포하지 않은 것으로 보인다(waitlist만, 다운로드 링크 전무). "레퍼런스 제품이 Mac 앱으로 나왔으니 우리도"라는 논리를 세울 근거가 없다—omnis의 Mac 앱 여부는 순수하게 자체 요구사항(맥미니 허브+상시 실행+Accessibility API 필요성, `18` 참고)으로 결정해야 한다. effort/risk 해당없음(정보 부재를 확인한 것 자체가 결론).

**waitlist/소셜 지표를 경쟁 벤치마크로 쓰지 마라.** 27k~32k 대기자와 82.5k/56.6k 팔로워는 콘텐츠 마케팅(171개 유튜브 영상)의 결과물이지 제품 성숙도 지표가 아니다—Instagram 자체 공개 "1,000명 온보딩"이 훨씬 현실에 가까운 숫자다. omnis는 1인 전용 제품이라 애초에 이 지표들이 무의미하지만, "kinso가 크다"는 인상에 design fidelity 목표를 과도하게 맞추지 않도록 주의. effort/risk 해당없음.

**리스크(ToS/계정정지/유지보수) 관점**: 이번 조사는 스크린샷 수집만 했고 로그인·크롤링 자동화는 하지 않았음(Instagram 로그인 월 우회 안 함, robots 위반 없음)—추가 리스크 없음. 단 kinso.ai의 마케팅 이미지(로고, 제품 mockup)는 저작권이 있는 자산이므로 omnis 자체 UI에 그대로 재사용 금지, 레이아웃/패턴 참고에만 사용. effort 없음, risk 낮음(patterns는 저작권 보호 대상 아님, 이미지 자체는 보호 대상).

## 5. What to borrow

- **리스트 행 컴포넌트**: 아바타(원형, 고정 크기) + 이름(bold) + 타임스탬프(같은 줄, 우측 정렬 or 이름 옆) + 프리뷰(회색, 1줄 truncate) + 우측 끝 브랜드 아이콘 슬롯. omnis의 통합 인박스 리스트 컴포넌트 1차 스펙으로 그대로 채택 가능. 참고 이미지: `omnis/research/assets/kinso-teardown-2026-09-20/hero-desktop.png`.
- **Selected-row elevation 패턴**: hairline 구분선 대신 선택된 행만 흰 카드+soft shadow로 띄우는 방식—shadcn/ui의 `Card` + `hover:shadow-sm` 조합으로 1:1 구현 가능, `14` §6의 Tailwind 토큰에 `--shadow-row-selected` 하나 추가.
- **Pill 입력창 + 그라디언트 stroke 포커스 상태**: "Ask Kinso"/"Ask/Search" 통합 커맨드바에 그대로 적용 가능. CSS로는 `border-image` 또는 `background: linear-gradient(...) border-box, linear-gradient(...) padding-box` 이중 배경 트릭으로 구현.
- **점선 unread 인디케이터**: solid dot 대신 dashed circle—omnis 알림 카드/토스트에 차별점으로 채택 고려.
- **채널 아이콘 = squircle 타일 + 컬러 글로우 halo**(`integration-icons.png` 참고): 설정 화면의 "연결된 채널" 그리드에 그대로 쓸 수 있는 패턴, iOS 홈스크린 아이콘 미학과 자연스럽게 연결됨(Apple-native 톤과 부합).
- **모닝 브리핑 카피 구조**: "Good morning, {name}. You've got N new and M active conversations." + "Today's briefing" CTA pill—omnis의 nightly archive digest/모닝 브리핑 문구 템플릿으로 거의 그대로 재사용 가능(`17` 참고).
- **음성 인터페이스 UI**: 마이크 아이콘 in-input + "{Assistant} is speaking…" 상태 라벨 + 채팅 버블—omnis가 음성 브리핑을 붙일 경우(브리프에 명시된 기능은 아니지만 향후 확장 시) 직접 참고할 화면 구조.

## 6. Open questions

- 정확한 코너 반경 px, 타이포 스케일(font-size/line-height 래더), 폰트 패밀리명은 이미지 기반 추정치일 뿐—Figma MCP 인증 후 실제 파일을 열어 트레이싱하거나, kinso.ai의 컴파일된 CSS(`getComputedStyle` on 실제 텍스트 노드)를 체계적으로 덤프해야 정밀값을 얻는다(`14` §7의 기존 오픈퀘스천과 동일).
- 데스크톱 mockup의 macOS 창 프레임이 실제 Electron/Tauri/네이티브 앱 스크린샷인지, 순수 디자인 mockup(Figma/디자인 툴에서 만든 가짜 창)인지 구분 불가—고해상도 UI 디테일(폰트 렌더링, 안티앨리어싱)로 봤을 때 디자인 mockup 쪽에 가깝다는 인상이지만 확정 못함.
- "We Failed To Launch Australia's Most Viral Startup (kinda)" 영상 내용을 실제로 시청하지 않음—kinso의 제품 성숙도/피벗 여부를 더 정확히 판단하려면 이 영상과 "Growing Kinso App From..." 사이드바 영상을 시청 요약해야 함.
- kinso-site.webflow.io가 정확히 언제 만들어졌고 지금도 활성 마케팅 채널인지(A/B 테스트용인지 구버전 잔존인지) 불명.
- Smart Contacts/연락처 히스토리 기능의 실제 UI(화면 스크린샷)는 이번 조사에서 확보 못함—카피만 확인.

## 7. Sources

- https://www.kinso.ai/ (2026-09-20, 텍스트+스크린샷+DOM 인스펙션)
- https://framerusercontent.com/images/3Kfz1cxtmXzOANwMwOvBEIqKkc.png (데스크톱 히어로 mockup, 원본 5236×3667) (2026-09-20)
- https://framerusercontent.com/images/XdZduuYtL2qxbHrQityf1fQJNU.png (모바일 히어로 mockup) (2026-09-20)
- https://framerusercontent.com/images/nbqtoG9eTvcMzhObnDWIKPnPRP0.png (모닝브리핑 다크 mockup) (2026-09-20)
- https://framerusercontent.com/images/fx3BQ9tjcKsNZpKIkNuMhiqenA.png , https://framerusercontent.com/images/pdnVm6k5g3IJefbT3lg1rgc4I.png (컨텍스트 알림 카드) (2026-09-20)
- https://kinso-site.webflow.io/ (구버전/병행 사이트) (2026-09-20)
- https://www.instagram.com/kinso.app/ (82.5k 팔로워, 창업자 핸들, "1000 users" 캡션) (2026-09-20)
- https://www.youtube.com/@KinsoAI (56.6k 구독자, 171 영상, 영상 제목 목록) (2026-09-20)
- 교차 참고: `omnis/research/01-kinso-and-competitors.md` §2, §5 (이번 조사로 다수 UNVERIFIED 항목 승격)
- 교차 참고: `omnis/research/14-apple-ui-design-language.md` §6-7 (다크모드/토큰 관련 오픈퀘스천에 대한 정정 필요)
