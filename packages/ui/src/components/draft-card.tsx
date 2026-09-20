import { Button } from "./button.js";
import { OpaqueSurface } from "./glass-surface.js";

export interface DraftCardProps {
  body: string;
  rationale: string;
  onEditAndSend: () => void;
  onDiscard: () => void;
  onRegenerate: () => void;
}

/** A5-D9: draft는 항상 전문 노출(요약 금지). */
export function DraftCard(props: DraftCardProps) {
  return (
    <OpaqueSurface className="draft-card">
      <p className="draft-card__rationale">omnis 초안 · 근거: {props.rationale}</p>
      <p className="draft-card__body">{props.body}</p>
      <div className="draft-card__actions">
        <Button onClick={props.onEditAndSend}>수정 후 보내기</Button>
        <Button variant="ghost" onClick={props.onDiscard}>
          버리기
        </Button>
        <Button variant="ghost" onClick={props.onRegenerate}>
          다시 생성
        </Button>
      </div>
    </OpaqueSurface>
  );
}
