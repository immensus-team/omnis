import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import type { AgentSessionKinsoState } from "../lib/row-meta.js";

/** 그룹 헤더·필터 바용 tinted pill(ref-issue-tracker-density.webp). 기존 `.status-badge`(999px
 * 캡슐, 12px, 행 우측 슬롯)와는 다른 역할이라 크기·반경을 일부러 나눈다 — 배지는 한 행 안의
 * 꼬리표, pill은 리스트를 묶는 헤더/필터다.
 * 카운트는 여기 없다: 레퍼런스에서 숫자는 pill 밖 별도 회색 칩이다(GroupHeader가 그린다). */
export type PillTone = "neutral" | "info" | "warning" | "danger" | "success";

export interface StatusPillProps {
  tone: PillTone;
  label: string;
  /** small filled dot before the label (default true). Set false when you pass `icon` instead. */
  dot?: boolean;
  /** optional leading icon element instead of the dot (lucide-react icon, size ~12-14px) */
  icon?: ReactNode;
  className?: string;
}

export function StatusPill({ tone, label, dot = true, icon, className }: StatusPillProps) {
  return (
    <span className={cn("status-pill", className)} data-tone={tone}>
      {icon ?? (dot && <span className="status-pill__dot" />)}
      {label}
    </span>
  );
}

/** A3 approvals 라이프사이클의 표시 상태. 라벨은 DB enum이 아니라 이 컴포넌트의 표시 전용
 * 매핑이다 — DB→여기의 변환은 Inbox.tsx의 approvalPillState가 한다.
 * failed/responded가 따로 있는 이유: 승인해 준 건의 실행이 실패한 걸 "거절됨"이라고 쓰면
 * 사용자가 하지 않은 행동을 했다고 말하는 게 된다(역제안도 거절이 아니다). */
export type ApprovalPillState =
  | "pending"
  | "approved"
  | "rejected"
  | "responded"
  | "failed"
  | "expired";

const APPROVAL_META: Record<ApprovalPillState, { label: string; tone: PillTone }> = {
  pending: { label: "대기", tone: "warning" },
  approved: { label: "승인됨", tone: "success" },
  rejected: { label: "거절됨", tone: "danger" },
  responded: { label: "역제안", tone: "info" },
  failed: { label: "실패", tone: "danger" },
  expired: { label: "만료", tone: "neutral" },
};

export function ApprovalStatusPill({ state }: { state: ApprovalPillState }) {
  const { label, tone } = APPROVAL_META[state];
  return <StatusPill tone={tone} label={label} />;
}

/** AgentSessionKinsoState(idle/working/blocked/done) 그대로 씀 — DB 매핑(row-meta.ts DB_STATE_TO_KINSO)이
 * failed를 blocked로 접는다는 기존 설계 결정은 그대로 둔다. 이 태스크 브리프는 pill variant로
 * "실패"도 요구하지만, 실제 agent_sessions.state에서 독립적으로 오는 값이 아니라서 별도의
 * presentational-only 상태(AgentPillState)로 얹는다 — AgentSessionKinsoState를 건드리지 않는다.
 * ponytail: 나중에 실패를 blocked와 분리해서 보여줘야 하면 여기 AgentPillState와
 * row-meta.ts의 DB_STATE_TO_KINSO를 함께 넓힌다. */
export type AgentPillState = AgentSessionKinsoState | "failed";

const AGENT_META: Record<AgentPillState, { label: string; tone: PillTone }> = {
  idle: { label: "대기", tone: "neutral" },
  working: { label: "작업 중", tone: "info" },
  // 기존 AgentStatusBadge(status-badge.tsx)·DESIGN-DIRECTION.md("blocked = 내 응답 필요")와 라벨을
  // 맞춘다 — 브리프 원문은 "차단됨"이었지만 같은 상태를 한 화면에서 두 문구로 보여주면 안 된다.
  blocked: { label: "확인 필요", tone: "danger" },
  done: { label: "완료", tone: "success" },
  failed: { label: "실패", tone: "danger" },
};

export function AgentStatusPill({ state }: { state: AgentPillState }) {
  const { label, tone } = AGENT_META[state];
  return <StatusPill tone={tone} label={label} />;
}
