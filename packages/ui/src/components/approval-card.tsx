import { Button } from "./button.js";
import { OpaqueSurface } from "./glass-surface.js";

export type ApprovalCardAction =
  | "send"
  | "delete"
  | "calendar_write"
  | "delegate"
  | "self_model_edit"
  | "memory_write";
export type ApprovalCardDecision = "accept" | "edit" | "respond" | "ignore";

/** @omnis/protocol의 HumanInterrupt를 미러링(패키지 경계 판정 — protocol import 안 함). */
export interface ApprovalCardInterrupt {
  action: ApprovalCardAction;
  description: string;
  args?: Record<string, unknown>;
  config: {
    allow_accept: boolean;
    allow_edit: boolean;
    allow_respond: boolean;
    allow_ignore: boolean;
  };
}

const ACTION_LABEL: Record<ApprovalCardAction, string> = {
  send: "전송",
  delete: "삭제",
  calendar_write: "캘린더 기록",
  delegate: "위임",
  self_model_edit: "프로필 수정",
  memory_write: "메모리 기록",
};

export interface ApprovalCardViewProps {
  interrupt: ApprovalCardInterrupt;
  onDecide: (decision: ApprovalCardDecision, decidedArgs?: Record<string, unknown>) => void;
}

export function ApprovalCardView({ interrupt, onDecide }: ApprovalCardViewProps) {
  const { config } = interrupt;
  return (
    <OpaqueSurface className="approval-card">
      <p className="approval-card__title">{ACTION_LABEL[interrupt.action]} 승인이 필요해요</p>
      <p className="approval-card__description">{interrupt.description}</p>
      <div className="approval-card__actions">
        {config.allow_accept && <Button onClick={() => onDecide("accept", undefined)}>승인</Button>}
        {config.allow_edit && (
          <Button variant="ghost" onClick={() => onDecide("edit", interrupt.args)}>
            수정 후 승인
          </Button>
        )}
        {config.allow_respond && (
          <Button variant="ghost" onClick={() => onDecide("respond", undefined)}>
            응답
          </Button>
        )}
        {config.allow_ignore && (
          <Button variant="ghost" onClick={() => onDecide("ignore", undefined)}>
            무시
          </Button>
        )}
      </div>
    </OpaqueSurface>
  );
}
