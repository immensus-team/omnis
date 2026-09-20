import { Button } from "./button.js";
import { OpaqueSurface } from "./glass-surface.js";

export interface DraftCardProps {
  body: string;
  rationale: string;
  onEditAndSend: () => void;
  onDiscard: () => void;
  onRegenerate: () => void;
}

/** A5-D9: the draft is always shown in full — never a summary. The copy is the `en` dictionary's
 *  (i18n/en.ts §8); `en` is the source locale, and the Korean in i18n/ko.ts is the optional
 *  add-on. */
export function DraftCard(props: DraftCardProps) {
  return (
    <OpaqueSurface className="draft-card">
      <p className="draft-card__rationale">omnis draft · rationale: {props.rationale}</p>
      <p className="draft-card__body">{props.body}</p>
      <div className="draft-card__actions">
        <Button onClick={props.onEditAndSend}>Edit &amp; send</Button>
        <Button variant="ghost" onClick={props.onDiscard}>
          Discard
        </Button>
        <Button variant="ghost" onClick={props.onRegenerate}>
          Regenerate
        </Button>
      </div>
    </OpaqueSurface>
  );
}
