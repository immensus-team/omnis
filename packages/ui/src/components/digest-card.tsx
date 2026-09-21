import { Button } from "./button.js";
import { OpaqueSurface } from "./glass-surface.js";

export interface DigestCardProps {
  kind: "morning" | "nightly";
  headline: string;
  body: string;
  onOpen?: () => void;
}

/** A5 §5.2: the entry card shared by the morning and nightly digests. The category accordion
 *  belongs to the Digest screen (§3.8) — this is only the card that gets you there.
 *
 *  It is an OpaqueSurface, not glass: it sits in a screen's body, and DESIGN-DIRECTION keeps glass
 *  on the sidebar/toolbar/sheet/palette only. */
export function DigestCard({ kind, headline, body, onOpen }: DigestCardProps) {
  return (
    <OpaqueSurface className="digest-card" data-digest-kind={kind}>
      <div className="digest-card__text">
        <p className="digest-card__headline">{headline}</p>
        {body !== "" && <p className="digest-card__body">{body}</p>}
      </div>
      {/* No handler means no control: the morning briefing is rendered in place, so its card has
          nothing to open, and a button that does nothing is worse than no button. */}
      {onOpen && (
        <Button variant="ghost" onClick={onOpen}>
          View →
        </Button>
      )}
    </OpaqueSurface>
  );
}
