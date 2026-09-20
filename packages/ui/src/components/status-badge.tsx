import type { AgentSessionKinsoState } from "../lib/row-meta.js";
import type { UiItemStatus } from "../types.js";

const STATUS_LABEL: Record<UiItemStatus, string> = {
  received: "받음",
  read: "읽음",
  draft: "초안",
  approved: "승인됨",
  sent: "전송됨",
  failed: "실패",
  archived: "보관됨",
};

export function StatusBadge({ status }: { status: UiItemStatus }) {
  return (
    <span className="status-badge" data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** U2: InboxRow 우측 고정 슬롯이 agent_session 행에서 채널 아이콘 대신 보여주는 배지
 * (herdr idle/working/blocked/done — DESIGN-DIRECTION.md, row-meta.ts가 DB state를 여기로 매핑). */
const AGENT_STATE_LABEL: Record<AgentSessionKinsoState, string> = {
  idle: "대기",
  working: "작업 중",
  blocked: "확인 필요",
  done: "완료",
};

export function AgentStatusBadge({ state }: { state: AgentSessionKinsoState }) {
  return (
    <span className="status-badge status-badge--agent" data-agent-state={state}>
      {AGENT_STATE_LABEL[state]}
    </span>
  );
}
