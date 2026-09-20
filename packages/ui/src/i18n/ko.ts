/** A5 §8 마이크로카피 표의 한국어 원문(기본 로케일). 이 객체가 키 형태의 진실 원천이다 —
 * types.ts의 `Dictionary`는 `typeof ko`로 파생되고, en.ts는 그 타입으로 선언되어 키가 빠지면
 * 컴파일 에러가 난다. 화면(namespace)은 슬라이스별로 여기에 추가한다. */
export const ko = {
  common: {
    draftCard: {
      editAndSend: "수정 후 보내기",
      discard: "버리기",
      regenerate: "다시 생성",
    },
    approvalSheet: {
      accept: "승인",
      edit: "수정 후 승인",
      ignore: "무시",
      respond: "응답",
    },
    // 복수형 규약(§8 표엔 없는 키 — index.ts의 plural 메커니즘을 실제로 태우는 유일한 키).
    // 한국어는 CLDR상 복수 범주가 "other" 하나뿐이라 평문으로 둔다.
    itemCount: "{count}개 항목",
  },
  errors: {
    inbox: { channelDisconnected: "{channel} 연결이 끊겼어요 — 재연결" },
    offline: { banner: "오프라인 — 마지막 동기화 {n}분 전" },
  },
  emptyStates: {
    inbox: "받은 편지함이 비어 있습니다",
    tasksToday: "오늘 할 일이 없어요",
    tasksDelegated: "위임한 작업이 없어요",
    network: "아직 연락처가 없어요 — 인박스에서 자동으로 채워집니다",
  },
  approvals: {
    killSwitchConfirm: "정말로 모든 자율 실행을 멈추시겠어요?",
    autonomyOnWarning: "이 대상에게는 승인 없이 자동 발송됩니다",
    pushNotification: "{action} 승인이 필요해요 · {summary}",
  },
  onboarding: {
    channelNotConnected: "맥미니에서 설정이 필요해요",
    firstSyncInProgress: "메시지를 가져오는 중…",
  },
  digest: {
    restoredToast: "되살렸습니다 · 실행 취소",
    briefingPreparing: "브리핑 준비 중, {n}분 후 갱신",
  },
  inbox: {
    title: "받은 편지함",
    // 필터 pill 5개(§2.1 사이드바). 스펙 다이어그램이 영문 표기뿐이라 한국어는 화면 문법에 맞춰 옮겼다.
    filters: {
      all: "전체",
      work: "업무",
      personal: "개인",
      agents: "에이전트",
      needsApproval: "승인 필요",
    },
    // 다중 선택 시 상단 bulk action bar(§3.1 구성요소) — 스펙이 나열한 3개 그대로.
    bulk: {
      archive: "보관",
      label: "라벨",
      delegate: "위임",
    },
    draftPrefix: "초안: {preview}",
    emptyChannels: "연결된 채널: {n}개 정상",
    // 채널 아이콘은 장식이 아니라 정보 전달(§3.1 접근성). 런타임 아이콘 문구는 스펙에 예시가 없어 같은 문법으로 맞춘 것.
    channelIcon: "{channel} 메시지",
    runtimeIcon: "{runtime} 세션",
    unread: "안읽음",
    labelChip: "{kind} 라벨: {name}",
    moreLabels: "라벨 {n}개 더 보기",
  },
  thread: {
    // ThreadHeader 액션 버튼(§3.2 다이어그램 [Archive][Label][⋯]).
    actions: {
      archive: "보관",
      label: "라벨",
      more: "더 보기",
    },
    draftProvenance: "omnis 초안 · 근거: {sources}",
    draftFailed: "초안 생성 실패 — 다시 시도",
    empty: "메시지가 없습니다",
    autoArchived: "자동 보관됨 · {n}일 전 — 되살리기",
    composerReadOnly: "이 채널은 승인 후 발신",
    // inferred, not in §8/§3 verbatim — Composer는 §3.2가 이름만 대고 플레이스홀더 문구는 주지 않음.
    composerPlaceholder: "메시지를 입력하세요",
  },
  agentSession: {
    readOnly: "읽기 전용",
    readSession: "세션 읽기",
    connecting: "{runtime}에 연결하는 중…",
    connectFailed: "{host}의 local-agent에 연결할 수 없음, Tailscale 확인",
    reconnect: "재연결",
    notLive: "실시간 아님",
    // TOOL_LABELS(§3.3, 마스터 §11 tool 목록) 원문 그대로.
    tool: {
      read: "읽는 중",
      searchMemory: "메모리 검색 중",
      readCalendar: "캘린더 확인 중",
      readSession: "다른 세션 확인 중",
      proposeDraft: "답장 초안 작성 중",
      proposeTask: "할 일 추출 중",
      proposeDelegation: "위임 제안 중",
      proposeRoute: "노트 라우팅 제안 중",
    },
    // ToolCallBadge state(§3.3): 완료 ✓ / 진행 ⏳ 는 다이어그램 원문, 오류는 "⚠ + 재시도"로만 적혀 있어 라벨을 같은 문법으로 채움.
    toolState: {
      running: "진행",
      done: "완료",
      error: "실패",
      retry: "다시 시도",
    },
    // 승인 후 시스템이 실행한 결과 로그(§3.3, kind='system' 한 줄).
    systemDelegated: "✓ {runtime}에게 위임됨 · {time}",
  },
  askPanel: {
    // inferred, not in §8/§3 verbatim — §3.3은 "d로 후속 delegate 요청 팔레트"만 언급하고 입력 문구는 없음.
    placeholder: "메시지를 입력하세요",
    send: "보내기",
  },
};
