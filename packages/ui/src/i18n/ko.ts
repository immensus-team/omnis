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
};
