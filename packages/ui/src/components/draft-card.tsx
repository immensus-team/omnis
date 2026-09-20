import { Button } from "./button.js";
import { OpaqueSurface } from "./glass-surface.js";

export interface DraftCardProps {
  body: string;
  rationale: string;
  onEditAndSend: () => void;
  onDiscard: () => void;
  onRegenerate: () => void;
}

/** A5-D9: the draft is always shown in full — never a summary.
 *
 *  US-D05: the provenance line used to read "omnis draft · rationale: …". Three things were wrong
 *  with it and none of them were the wording. The middle dot is the `A · B · C` metadata separator
 *  (SKILLS.md anti-slop item 5); "rationale" is the *prop's* name, not a word anyone using the app
 *  has met; and "omnis draft" is a lowercase machine tag standing where a sentence should be. It
 *  says the same thing as a sentence now, which is also what i18n/en.ts §8's `draftProvenance`
 *  holds — `en` is the source locale and the Korean in i18n/ko.ts is the optional add-on. */
export function DraftCard(props: DraftCardProps) {
  return (
    <OpaqueSurface className="draft-card">
      <p className="draft-card__rationale">Drafted from {props.rationale}</p>
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
