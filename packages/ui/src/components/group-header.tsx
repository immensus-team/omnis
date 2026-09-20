import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

/** 리스트를 상태별로 묶는 한 줄 헤더(ref-issue-tracker-density.webp의 "In review 6 +" 문법).
 * 레퍼런스대로 세 조각이다: 상태 pill(톤 컬러) → 카운트(pill 밖 별도 회색 칩) → +.
 * 카운트를 pill 안에 넣으면 헤더가 바로 위 필터 칩 줄과 같은 크기·같은 모양의 네 번째 칩으로
 * 읽힌다 — 분리해야 "섹션 라벨 + 개수"로 읽힌다. 카드 크롬(테두리·배경·그림자)은 두지 않는다:
 * 헤더는 행 사이의 라벨이지 또 하나의 서피스가 아니다. */
export interface GroupHeaderProps {
  pill: ReactNode; // an <ApprovalStatusPill/> or <AgentStatusPill/>
  /** 이 그룹의 행 개수. 0도 실제 값이라 undefined일 때만 칩을 생략한다. */
  count?: number | undefined;
  /** omit to render no add-affordance (most callers today — there's no "create new approval/session" flow yet) */
  onAdd?: () => void;
  className?: string;
}

export function GroupHeader({ pill, count, onAdd, className }: GroupHeaderProps) {
  return (
    // role="presentation": 이 헤더들은 Virtuoso의 role="listbox" 안에 행과 섞여 들어간다.
    // 기본 role(generic)이면 AT가 listbox의 자식 수를 옵션 수로 세어 실제 행보다 많게 읽는다.
    <div role="presentation" className={cn("group-header", className)}>
      {pill}
      {count !== undefined && <span className="group-header__count">{count}</span>}
      {onAdd && (
        <button type="button" className="group-header__add" onClick={onAdd} aria-label="추가">
          +
        </button>
      )}
    </div>
  );
}
