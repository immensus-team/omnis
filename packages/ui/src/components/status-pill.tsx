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
  className?: string;
}

export function StatusPill({ tone, label, className }: StatusPillProps) {
  return (
    <span className={cn("status-pill", className)} data-tone={tone}>
      <span className="status-pill__dot" />
      {label}
    </span>
  );
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
  // 라벨과 톤 **둘 다** 행 배지(status-badge.tsx AgentStatusBadge)와 맞춘다. 2회차는 라벨만
  // 맞추고 색은 danger로 둬서, 같은 "확인 필요"가 헤더에선 빨강 · 행에선 파랑으로 갈렸다.
  // warning인 이유: blocked는 "내 응답 필요"지 에러가 아니다(에러는 failed) — 이 저장소가
  // 이미 "네 차례"에 쓰는 색은 --warn-500이다(.inbox-row__approval-dot, 승인 대기 점).
  // 실제 색은 app.css에서 한 규칙이 pill과 배지에 동시에 준다(선택자 두 개, 값 하나).
  blocked: { label: "확인 필요", tone: "warning" },
  done: { label: "완료", tone: "success" },
  failed: { label: "실패", tone: "danger" },
};

export function AgentStatusPill({ state }: { state: AgentPillState }) {
  const { label, tone } = AGENT_META[state];
  return <StatusPill tone={tone} label={label} />;
}
