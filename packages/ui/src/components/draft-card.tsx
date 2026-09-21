import { Button } from "./button.js";
import { OpaqueSurface } from "./glass-surface.js";

export interface DraftCardProps {
  body: string;
  rationale: string;
  onDiscard: () => void;
}

/** A5-D9: the draft is always shown in full — never a summary.
 *
 *  US-D05: the provenance line used to read "omnis draft · rationale: …". Three things were wrong
 *  with it and none of them were the wording. The middle dot is the `A · B · C` metadata separator
 *  (SKILLS.md anti-slop item 5); "rationale" is the *prop's* name, not a word anyone using the app
 *  has met; and "omnis draft" is a lowercase machine tag standing where a sentence should be. It
 *  says the same thing as a sentence now, which is also what i18n/en.ts §8's `draftProvenance`
 *  holds — `en` is the source locale and the Korean in i18n/ko.ts is the optional add-on.
 *
 *  loop-r2-02: this card is the *fallback*. When a draft has a pending approval of its own — the
 *  usual case, since that is what proposing one raises — the thread view folds the two together and
 *  renders a single `ApprovalCardView` instead (`foldDraft` in apps/desktop's Thread.tsx). What is
 *  left for this card is a draft nobody has been asked about, so the only thing it can offer is to
 *  throw it away; "Edit & send" and "Regenerate" were removed here rather than left as buttons that
 *  did nothing, which is what the testers reported. "Edit & send" comes back on loop-r2-03, wired to
 *  the composer. */
export function DraftCard(props: DraftCardProps) {
  return (
    <OpaqueSurface className="draft-card">
      <p className="draft-card__rationale">Drafted from {props.rationale}</p>
      <p className="draft-card__body">{props.body}</p>
      <div className="draft-card__actions">
        <Button variant="ghost" onClick={props.onDiscard}>
          Discard
        </Button>
      </div>
    </OpaqueSurface>
  );
}
