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
    // inferred, not in §8/§3 verbatim — §3.9의 경고/확인 다이얼로그는 본문만 인용하고 버튼 라벨은
    // 주지 않는다. 두 다이얼로그(자율 허용 경고, kill switch 확인)가 공유하는 네이티브 다이얼로그 버튼.
    dialog: {
      confirm: "확인",
      cancel: "취소",
    },
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
    // §7.1 5단계 이름(Welcome / Connect channels / Self-model seed / First sync / First briefing).
    // 스펙은 영문 단계명만 주므로 inbox.filters와 같은 방식으로 옮겼다 — 단계 표시줄용이라 짧게.
    // 4·5단계의 대기 문구는 이미 있는 firstSyncInProgress / digest.briefingPreparing을 그대로 쓴다.
    steps: {
      welcome: "환영",
      connectChannels: "채널 연결",
      selfModel: "self-model 초안",
      firstSync: "첫 동기화",
      firstBriefing: "첫 브리핑",
    },
    welcome: "omnis에 오신 걸 환영해요",
    // inferred, not in §7.1 verbatim — 스펙은 "OAuth, 순서 무관"과 "'나중에 연결' 버튼으로 항상 스킵
    // 가능"이라고만 적고 연결 버튼 라벨은 주지 않는다(스킵 라벨은 스펙 원문 그대로).
    connect: "연결",
    connectLater: "나중에 연결",
  },
  digest: {
    restoredToast: "되살렸습니다 · 실행 취소",
    briefingPreparing: "브리핑 준비 중, {n}분 후 갱신",
    // §3.8 카드 헤더("9월 19일 밤 다이제스트 · 42개 보관됨"). 날짜 문자열 포맷은 호출부 몫이라 {date}로 받는다.
    heading: "{date} 밤 다이제스트 · {n}개 보관됨",
    // 카테고리 헤딩("📧 이메일 (31)") — 이모지는 장식이라 문구에서 뺐다(§9 QA "장식용 이모지 금지").
    categoryHeading: "{category} ({n})",
    category: {
      email: "이메일",
      message: "메시지",
    },
    // 접힌 그룹의 요약 줄("뉴스레터 12건, 알림 8건, 영수증 11건 — [모두 보기]") — 조각을 호출부에서 ", "로 잇는다.
    categoryCount: "{label} {n}건",
    viewAll: "모두 보기",
    // 월간 비용 리포트(마스터 §14 비용 정책의 UI 노출 지점). 예: "이번 달 비용 리포트: $34 / $60 (57%)".
    costReport: "이번 달 비용 리포트: {spent} / {limit} ({percent}%)",
    restore: "되살리기",
    loading: "오늘 밤 다이제스트는 아직 생성 전이에요, 23:00에 생성됩니다",
    // 빈 상태는 §7.2의 "Notes/Digest 빈 = 담백하게" 지침대로 짧게 — 그래서 emptyStates가 아니라 여기 있다.
    empty: "오늘은 보관할 게 없었어요",
    // 스펙이 오류 상태를 "다이제스트 생성 실패, 수동으로 다시 시도"라는 한 덩어리 버튼으로 인용한다 —
    // 메시지/버튼으로 쪼개면 스펙에 없는 문구를 만드는 셈이라 인용 그대로 한 키로 둔다.
    error: "다이제스트 생성 실패, 수동으로 다시 시도",
  },
  settings: {
    // 좌측 서브 nav 4개(§3.9 다이어그램). 스펙이 영문 표기뿐이라 inbox.filters와 같은 방식으로 옮겼다 —
    // 목업에서 섹션 헤딩이 이 라벨을 그대로 반복하므로 별도 heading 키를 두지 않는다.
    nav: {
      accounts: "계정",
      autonomy: "자율 실행",
      modelTiers: "모델 티어",
      general: "일반",
    },
    accounts: {
      // 행의 상태 점 옆 텍스트(§3.9 접근성: 색만으로 상태를 전달하지 않음).
      status: {
        connected: "연결됨",
        readOnly: "읽기 전용",
      },
      reconnect: "재연결",
      // 오류 상태("재연결 실패 시 인라인 에러 + 재시도") — 문구가 따로 없어 에러와 재시도 어포던스를
      // 한 줄로 합쳤다. 재시도는 같은 행의 [재연결] 버튼이 겸한다.
      reconnectFailed: "재연결 실패 — 재시도",
      // KakaoTalk send 게이팅(마스터 §3/§19 Q3): read 안정화 14일 전엔 비활성 + 남은 일수 라벨.
      // 잔여일은 툴팁과 행 본문 양쪽에 같은 텍스트로 병기한다(툴팁을 못 보는 상황 대비).
      sendEnable: "send 활성화",
      sendEnableCountdown: "send 활성화 (D-{days})",
      sendEnableTooltip: "read 안정화 {elapsed}/14일 · {remaining}일 후 활성화",
    },
    autonomy: {
      // 채널·사람별 승인 게이트 override 토글(§3.9가 "자율 허용"으로 인용한 라벨 그대로).
      // 켤 때 뜨는 경고 다이얼로그 본문은 §8 표 문구(approvals.autonomyOnWarning)를 재사용한다 —
      // §3.9는 "이 채널/사람에게는 …"으로 조금 더 길지만 표가 정본이라 중복 정의하지 않는다.
      allowToggle: "자율 허용",
    },
    modelTiers: {
      spentHeading: "이번 달 현재 지출",
      spent: "{amount} 사용",
      // inferred, not in §3.9 verbatim — 스펙은 "상한 숫자 입력 필드"라고만 하고 필드 라벨은 주지 않는다.
      limitLabel: "월 비용 상한",
      // 예비비 10%는 상한에 종속된 계산값이라 편집 불가 — 라벨만 고정 텍스트로 노출한다.
      reserveLabel: "VIP·민감 스레드 예비비",
      // 진행률 바 위 텍스트(§9 접근성: 색만으로 임계값을 전달하지 않음).
      statusNormal: "정상",
      statusWarning: "T2→T1 강등",
      statusOver: "비VIP 초안 중단",
      // inferred, not in §3.9 verbatim — 진행률 바에 접근성 이름이 필요해 같은 문법으로 채웠다.
      usageBarLabel: "월 비용 사용률",
      save: "저장",
    },
    killSwitch: {
      // §3.9 목업의 섹션 라벨이 영문 그대로("⚠ Kill switch")라 한국어 문장 안에서도 그대로 쓴다.
      // 확인 다이얼로그 본문은 이미 있는 approvals.killSwitchConfirm을 재사용한다(§8 표가 정본 —
      // §3.9 본문은 "모든 자율 루프를"로 다른데, 표 문구가 이미 구현돼 있어 그쪽을 따른다).
      heading: "Kill switch",
      stopAll: "모든 자율 실행 중지",
    },
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
  // derived from §3.1 InboxRow examples + errors.offline.banner pattern, not a dedicated spec table.
  // 문장 안에서 쓰는 긴 형태의 상대시간이다 — 행의 압축 코드("3m"/"2w"/"4 Aug")는 lib/relative-time.ts가
  // 담당하고 이 네임스페이스는 관여하지 않는다(같은 값을 두 형식으로 내는 게 의도).
  relativeTime: {
    justNow: "방금",
    minutesAgo: "{n}분 전",
    hoursAgo: "{n}시간 전",
    daysAgo: "{n}일 전",
    yesterday: "어제",
  },
};
