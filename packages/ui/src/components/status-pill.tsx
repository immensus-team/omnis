import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import type { AgentSessionKinsoState } from "../lib/row-meta.js";

/** 그룹 헤더·필터 바용 tinted pill(ref-issue-tracker-density.webp). 기존 `.status-badge`(999px
 * 캡슐, 12px, 행 우측 슬롯)와는 다른 역할이라 크기·반경을 일부러 나눈다 — 배지는 한 행 안의
 * 꼬리표, pill은 리스트를 묶는 헤더/필터다. */
export type PillTone = "neutral" | "info" | "warning" | "danger" | "success";

export interface StatusPillProps {
  tone: PillTone;
  label: string;
  /** optional trailing count, e.g. group header "6" */
  count?: number | undefined;
  /** small filled dot before the label (default true). Set false when you pass `icon` instead. */
  dot?: boolean;
  /** optional leading icon element instead of the dot (lucide-react icon, size ~12-14px) */
  icon?: ReactNode;
  className?: string;
}

export function StatusPill({ tone, label, count, dot = true, icon, className }: StatusPillProps) {
  return (
    <span className={cn("status-pill", className)} data-tone={tone}>
      {icon ?? (dot && <span className="status-pill__dot" />)}
      {label}
      {count !== undefined && <span className="status-pill__count">{count}</span>}
    </span>
  );
}

/** A3 approvals 판정 4상태. 라벨은 DB enum이 아니라 이 컴포넌트의 표시 전용 매핑이다. */
export type ApprovalPillState = "pending" | "approved" | "rejected" | "expired";

const APPROVAL_META: Record<ApprovalPillState, { label: string; tone: PillTone }> = {
  pending: { label: "대기", tone: "warning" },
  approved: { label: "승인됨", tone: "success" },
  rejected: { label: "거절됨", tone: "danger" },
  expired: { label: "만료", tone: "neutral" },
};

export function ApprovalStatusPill({
  state,
  count,
}: {
  state: ApprovalPillState;
  count?: number | undefined;
}) {
  const { label, tone } = APPROVAL_META[state];
  return <StatusPill tone={tone} label={label} count={count} />;
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
  blocked: { label: "차단됨", tone: "danger" },
  done: { label: "완료", tone: "success" },
  failed: { label: "실패", tone: "danger" },
};

export function AgentStatusPill({
  state,
  count,
}: {
  state: AgentPillState;
  count?: number | undefined;
}) {
  const { label, tone } = AGENT_META[state];
  return <StatusPill tone={tone} label={label} count={count} />;
}
