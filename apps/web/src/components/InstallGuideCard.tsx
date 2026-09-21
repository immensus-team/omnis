import { Button, OpaqueSurface } from "@omnis/ui";

/** A5 §4.5: Safari has no install banner of its own, so the app asks for the one action it cannot
 *  take itself. Three steps, in the order Safari's UI makes them available.
 *
 *  The card is body, not chrome (it sits in the list column and pushes content down), so it is an
 *  OpaqueSurface — glass belongs to the rail, toolbar, sheet and palette only. */
const STEPS = [
  "Tap the Share button in Safari's toolbar.",
  "Choose Add to Home Screen.",
  "Open omnis from its new icon. It runs full screen and can receive Web Push.",
];

export function InstallGuideCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <OpaqueSurface
      className="install-card"
      // biome-ignore lint/a11y/useSemanticElements: this is an inline banner in the list flow, not
      // a modal — a native <dialog> would need `open` (it is display:none otherwise) and would be
      // taken out of flow by the UA's own positioning, which is the opposite of what a guide that
      // pushes the list down needs.
      role="dialog"
      aria-label="Add to Home Screen"
    >
      <h2 className="install-card__title">Keep omnis on your Home Screen</h2>
      <ol className="install-card__steps">
        {STEPS.map((step) => (
          <li key={step} className="install-card__step">
            {step}
          </li>
        ))}
      </ol>
      {/* Web Push permission is deliberately not asked for here: A5 §4.5 wants it requested in
          context, when the first pending approval appears. */}
      <Button variant="primary" className="install-card__dismiss" onClick={onDismiss}>
        Got it
      </Button>
    </OpaqueSurface>
  );
}
