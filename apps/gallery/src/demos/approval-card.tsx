import { type ApprovalCardInterrupt, ApprovalCardView } from "@omnis/ui";

/** config 3종으로 버튼 조건부 렌더링을 전부 드러낸다:
 *  - send: 승인 + 수정 후 승인 + 무시 (3개)
 *  - calendar_write: 승인만 (allow_* 3개가 false면 버튼이 사라진다)
 *  - delegate: 응답 + 무시 (allow_accept=false면 주 버튼이 없다) */
const INTERRUPTS: ApprovalCardInterrupt[] = [
  {
    action: "send",
    description: "김민지님께 회의 시간 확정 답장을 보냅니다.",
    config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
  },
  {
    action: "calendar_write",
    description: "목요일 15:00 '디자인 리뷰' 일정을 캘린더에 추가합니다.",
    config: { allow_accept: true, allow_edit: false, allow_respond: false, allow_ignore: false },
  },
  {
    action: "delegate",
    description: "정산 내역 확인을 재무 에이전트에게 넘깁니다.",
    config: { allow_accept: false, allow_edit: false, allow_respond: true, allow_ignore: true },
  },
];

export function ApprovalCardDemo() {
  return (
    <div>
      {INTERRUPTS.map((interrupt) => (
        <div key={interrupt.action} style={{ marginBottom: 16 }}>
          <ApprovalCardView interrupt={interrupt} onDecide={() => {}} />
        </div>
      ))}
    </div>
  );
}
