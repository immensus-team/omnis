# i18n 하드코딩 문구 스캔 리포트

`tsx tools/i18n/scan.ts`가 생성한다 — 손으로 고치지 말 것(다음 실행에 덮인다).
이 리포트는 **읽기 전용 스캔** 결과다: 스크립트는 소스를 고치지 않는다.

## 요약

- 스캔한 파일: 32
- 후보 문자열: 68
  - apps/desktop/src: 16건
  - packages/ui/src: 52건

`Suggested key`는 컴포넌트 이름 + 위치(placeholder/ariaLabel/button/text) + 문자열 속 영단어로
만든 **출발점**이다. 한국어 문구는 영단어가 없어 `l{줄번호}`로 떨어진다 — 옮기면서 이름을
다시 짓는 게 전제다.

## apps/desktop/src/App.tsx

| Line | Text | Suggested key |
| --- | --- | --- |
| 76 | Inbox로 이동 | `shell.text.inbox` |
| 78 | 이동 | `shell.text.l78` |

## apps/desktop/src/screens/Inbox.tsx

| Line | Text | Suggested key |
| --- | --- | --- |
| 59 | (제목 없음) | `filters.text.l59` |
| 334 | Inbox 필터 | `inbox.ariaLabel.inbox` |
| 354 | 보관됨 | `inbox.label.l354` |

## apps/desktop/src/screens/Onboarding.tsx

| Line | Text | Suggested key |
| --- | --- | --- |
| 21 | Google Calendar | `requiredChannels.text.googleCalendar` |
| 56 | omnis에 오신 걸 환영해요 | `onboarding.label.omnis` |
| 63 | 연결됨 | `onboarding.text.l63` |
| 65 | 연결 중… | `onboarding.text.l65` |
| 66 | 연결 | `onboarding.text.l66` |
| 68 | 연결 실패, 다시 시도해주세요 | `onboarding.label.l68` |
| 72 | WhatsApp / KakaoTalk / LinkedIn: 맥미니에서 설정이 필요해요 | `onboarding.label.whatsappKakaotalkLinkedin` |
| 73 | 계속 | `onboarding.label.l73` |

## apps/desktop/src/screens/Thread.tsx

| Line | Text | Suggested key |
| --- | --- | --- |
| 37 | 보관됨 | `thread.button.l37` |
| 38 | 되살리기 | `thread.label.l38` |
| 52 | 메모리·과거 스레드 | `thread.text.l52` |

## packages/ui/src/components/approval-card.tsx

| Line | Text | Suggested key |
| --- | --- | --- |
| 27 | 전송 | `actionLabel.text.l27` |
| 28 | 삭제 | `actionLabel.text.l28` |
| 29 | 캘린더 기록 | `actionLabel.text.l29` |
| 30 | 위임 | `actionLabel.text.l30` |
| 31 | 프로필 수정 | `actionLabel.text.l31` |
| 32 | 메모리 기록 | `actionLabel.text.l32` |
| 47 | 승인 | `approvalCardView.label.l47` |
| 49 | 수정 후 승인 | `approvalCardView.label.l49` |
| 54 | 응답 | `approvalCardView.label.l54` |
| 59 | 무시 | `approvalCardView.label.l59` |

## packages/ui/src/components/channel-rail.tsx

| Line | Text | Suggested key |
| --- | --- | --- |
| 26 | 채널 | `channelRail.ariaLabel.l26` |
| 54 | 더 보기 | `channelRail.ariaLabel.l54` |
| 60 | 계정 | `channelRail.ariaLabel.l60` |
| 63 | 설정 | `channelRail.ariaLabel.l63` |

## packages/ui/src/components/command-palette.tsx

| Line | Text | Suggested key |
| --- | --- | --- |
| 44 | 결과가 없어요 | `commandPalette.label.l44` |
| 70 | Start typing to ask or search | `commandPalette.text.startTypingTo` |
| 87 | 검색 또는 명령… | `commandPalette.text.l87` |

## packages/ui/src/components/draft-card.tsx

| Line | Text | Suggested key |
| --- | --- | --- |
| 19 | 수정 후 보내기 | `draftCard.button.l19` |
| 20 | 버리기 | `draftCard.button.l20` |
| 23 | 다시 생성 | `draftCard.label.l23` |

## packages/ui/src/components/inbox-row.tsx

| Line | Text | Suggested key |
| --- | --- | --- |
| 71 | ${RUNTIME_LABEL[avatar.runtime]} 세션 | `icon.text.runtimeLabelAvatar` |
| 97 | 초안: ${props.summary} | `inboxRow.text.propsSummary` |
| 118 | 안읽음 | `inboxRow.ariaLabel.l118` |
| 127 | ${CHANNEL_LABEL[props.channel]} 메시지 | `inboxRow.text.channelLabelProps` |
| 133 | 승인 대기 | `inboxRow.ariaLabel.l133` |
| 146 | 되살리기 | `inboxRow.text.l146` |
| 146 | 보관 | `inboxRow.text.l146` |
| 159 | ${chip.kind} 라벨: ${chip.name} | `inboxRow.text.chipKindChip` |
| 165 | 라벨 ${more}개 더 보기 | `inboxRow.text.more` |

## packages/ui/src/components/status-badge.tsx

| Line | Text | Suggested key |
| --- | --- | --- |
| 5 | 받음 | `statusLabel.text.l5` |
| 6 | 읽음 | `statusLabel.text.l6` |
| 7 | 초안 | `statusLabel.text.l7` |
| 8 | 승인됨 | `statusLabel.text.l8` |
| 9 | 전송됨 | `statusLabel.text.l9` |
| 10 | 실패 | `statusLabel.text.l10` |
| 11 | 보관됨 | `statusLabel.text.l11` |
| 25 | 대기 | `agentStateLabel.text.l25` |
| 26 | 작업 중 | `agentStateLabel.text.l26` |
| 27 | 확인 필요 | `agentStateLabel.text.l27` |
| 28 | 완료 | `agentStateLabel.text.l28` |

## packages/ui/src/components/tool-call-badge.tsx

| Line | Text | Suggested key |
| --- | --- | --- |
| 14 | 읽는 중 | `toolLabels.text.l14` |
| 15 | 메모리 검색 중 | `toolLabels.text.l15` |
| 16 | 캘린더 확인 중 | `toolLabels.text.l16` |
| 17 | 다른 세션 확인 중 | `toolLabels.text.l17` |
| 18 | 답장 초안 작성 중 | `toolLabels.text.l18` |
| 19 | 할 일 추출 중 | `toolLabels.text.l19` |
| 20 | 위임 제안 중 | `toolLabels.text.l20` |
| 21 | 노트 라우팅 제안 중 | `toolLabels.text.l21` |
| 36 | ToolCallBadge: unknown tool "${tool}" — not in master §11 palette | `toolCallBadge.text.toolcallbadgeUnknownTool` |
| 43 | ⚠ 재시도 | `icon.label.l43` |

## packages/ui/src/lib/row-meta.ts

| Line | Text | Suggested key |
| --- | --- | --- |
| 22 | Google Calendar | `channelLabel.text.googleCalendar` |
| 74 | Claude Code | `runtimeLabel.text.claudeCode` |

## 이 도구의 한계 (오탐·누락은 정상)

- 완전한 파서가 아니다. TS 파서를 붙이지 않으려고 주석·문자열·템플릿만 걷는 상태 기계를 쓴다.
- 오탐: JSX처럼 보이는 비교식(`a > b < c`), 정규식 리터럴 안의 따옴표, 어퍼스트로피가 만드는
  가짜 문자열. 공백/대문자 휴리스틱이 대부분 걸러내지만 0은 아니다.
- 누락: 단어 하나짜리 영어 라벨(Save, Retry)은 기술 토큰으로 보고 버린다. 기본 로케일이 ko라
  같은 버튼이 한국어 쪽에서 잡히므로 의도적으로 감수한 트레이드오프다.
- 누락: `packages/ui/src/i18n/**`(사전), `*.test.ts(x)`, `node_modules`·`dist`는 대상이 아니다.
