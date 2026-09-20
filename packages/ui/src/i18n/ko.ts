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
  today: {
    // §3.4 다이어그램 인사말/요약 2문장 — 접근성상 <h1> 하나로 읽히는 페이지 요지.
    greeting: "좋은 아침이에요, {name}.",
    summary: "오늘 처리할 항목 {items}개, 대기 중 승인 {approvals}건.",
    // 밤 다이제스트 진입 카드(kind='nightly'가 있을 때만). 화살표는 장식이라 문구에서 제외.
    nightlyDigest: {
      ready: "밤 다이제스트 준비됨 · {n}개 보관됨",
      view: "보기",
    },
    // 캘린더 헤딩의 괄호는 출처 표기(Google Calendar 연동) — 제품명이라 양 로케일 동일.
    calendarHeading: "오늘 일정",
    calendarSource: "Google Calendar",
    // 브리핑 헤딩과 그 부제("밤 사이 생긴 것 중 중요도순")는 다이어그램에서 한 줄이지만 역할이 달라 분리.
    briefingHeading: "아침 브리핑",
    briefingSubheading: "밤 사이 생긴 것 중 중요도순",
    // §3.4 로딩 문구("브리핑 준비 중, N분 후 갱신")는 digest.briefingPreparing과 같은 문자열이라 중복 정의하지 않는다.
    // inferred, not in §8/§3 verbatim — §3.4는 "브리핑 섹션만 재시도 버튼"이라고만 적고 버튼 라벨은 주지 않음.
    briefingRetry: "다시 시도",
    pendingApprovals: "대기 중 승인 ({n})",
    approvalChipLabel: "대기 중 승인: {summary}, {time} 요청",
    emptyQuiet: "오늘은 조용하네요",
    offlineBadge: "{n}시간 전 기준",
  },
  tasks: {
    // §3.5 뷰 탭 4개 — tasks.due_at 기준 + owner_kind='agent'인 것만 Delegated.
    tabs: {
      today: "오늘",
      thisWeek: "이번 주",
      someday: "언젠가",
      delegated: "위임함",
    },
    // TaskRow 출처 딥링크 접두어("from: Gmail · 오늘 마감") — 다이어그램이 영문 표기라 inbox.filters와 같은 방식으로 옮김.
    source: "from: {source}",
    due: {
      today: "오늘",
      todayDeadline: "오늘 마감",
    },
    // 위임 행의 소유자 배지(다이어그램 "delegated · 진행 중"의 앞 토막).
    delegatedBadge: "위임",
    state: {
      inProgress: "진행 중",
      done: "완료",
      unknown: "상태 확인 불가",
    },
    // inferred, not in §8/§3 verbatim — §3.5는 "t 단축키로 빠른 task 추가 입력(제목만)"만 말하고 placeholder는 없음.
    quickAddPlaceholder: "할 일 추가",
  },
  network: {
    // §3.6 상단 스트립 — 스펙 다이어그램이 영문("Follow-up queue (3)")이라 inbox.filters와 같은 방식으로 옮김.
    followUpQueue: "팔로업 큐 ({n})",
    searchPlaceholder: "검색",
    lastContact: "마지막 연락: {when}",
    followUpSuggestion: "팔로업 제안: {suggestion}",
    // 관계 상태 dot의 텍스트 레이블(§3.6 접근성: 색만으로 전달하지 않음).
    // unknown은 dot 없이 텍스트만, dormantDays는 dot 대신 쓰는 "방치 5일" 형식.
    relationship: {
      active: "활성",
      warming: "관계 형성 중",
      dormant: "방치 위험",
      unknown: "정보 부족",
      dormantDays: "방치 {n}일",
    },
    // §3.6 사람 상세 pane의 구성요소 이름 — 그대로 섹션 헤딩으로 쓴다("메모"는 사람에 붙는 메모이지 Notes 화면이 아님).
    detail: {
      timeline: "상호작용 타임라인",
      channels: "전 채널 대화",
      notes: "메모",
    },
    // 팔로업 draft 버튼 세트는 thread의 DraftCard와 동일 → common.draftCard 재사용(중복 정의 안 함).
  },
  notes: {
    composerHeading: "새 노트",
    // inferred, not in §8/§3 verbatim — §3.7 다이어그램의 문장은 예시 내용이고 placeholder 문구는 없음.
    composerPlaceholder: "노트를 입력하세요",
    save: "저장",
    // 라우팅 제안(§3.7). 신뢰도는 퍼센트가 아니라 텍스트("신뢰도 높음"/"낮음") — 접근성 항목.
    routing: {
      heading: "라우팅 제안:",
      shareTo: "{target} 스레드에 공유",
      confidenceHigh: "신뢰도 높음",
      confidenceLow: "신뢰도 낮음",
      accept: "수락",
      pickOther: "다른 대상 선택",
      none: "라우팅 안 함",
    },
    // §8 표 "Notes 라우팅 낮은 신뢰도" — 신뢰도가 낮으면 제안 자체를 하지 않고 이 문구만 보여준다(§3.7 설계 원칙).
    lowConfidenceRouting: "라우팅 대상을 찾지 못했어요 — 수동으로 선택",
    recentHeading: "최근 노트",
    routedTo: "→ {target}",
    empty: "아직 노트가 없어요",
  },
};
