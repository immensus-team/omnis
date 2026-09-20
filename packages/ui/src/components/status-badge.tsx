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
