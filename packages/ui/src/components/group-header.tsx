import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

/** 리스트를 상태별로 묶는 한 줄 헤더(ref-issue-tracker-density.webp의 "In review 6 +" 문법).
 * pill 자체는 StatusPill이 이미 그리므로 여기서는 배치와 + 어포던스만 책임진다 — 그룹마다
 * 다른 카드 크롬(테두리·배경·그림자)을 두지 않는다: 헤더는 행 사이의 라벨이지 또 하나의
 * 서피스가 아니다. */
export interface GroupHeaderProps {
  pill: ReactNode; // an <ApprovalStatusPill/> or <AgentStatusPill/> with a count
  /** omit to render no add-affordance (most callers today — there's no "create new approval/session" flow yet) */
  onAdd?: () => void;
  className?: string;
}

export function GroupHeader({ pill, onAdd, className }: GroupHeaderProps) {
  return (
    <div className={cn("group-header", className)}>
      {pill}
      {onAdd && (
        <button type="button" className="group-header__add" onClick={onAdd} aria-label="추가">
          +
        </button>
      )}
    </div>
  );
}
