import { DraftCard } from "@omnis/ui";

/** 초안 카드는 변형이 없다 — 하나의 시각 상태만 존재(A5-D9: 본문 전문 노출, 요약 금지).
 *  콜백은 데모라 no-op. */
export function DraftCardDemo() {
  return (
    <DraftCard
      body="안녕하세요 민지님, 제안해 주신 목요일 오후 3시로 일정 잡겠습니다. 캘린더에 초대장을 보내드렸으니 확인 부탁드립니다. 혹시 시간대가 맞지 않으면 다른 시간도 알려주세요."
      rationale="최근 스레드 맥락 기반"
      onEditAndSend={() => {}}
      onDiscard={() => {}}
      onRegenerate={() => {}}
    />
  );
}
