import { useEffect, useState } from "react";
import { GlassSurface } from "./glass-surface.js";

/** loop-r2-05: the same five states the shell's `useConnection` produces. Spelled out here rather
 *  than imported because this package may not depend on either app — the two are structurally
 *  identical, so the app's value passes straight in. `ok` is the one that draws nothing. */
export type ConnectionBannerKind = "ok" | "connecting" | "offline" | "unreachable" | "session";

/** How long `connecting` has to last before it is worth a line. A normal start passes through
 *  `connecting` for a moment, and a banner that appears for 400ms on every launch is worse than no
 *  banner: it reads as an error that fixed itself. */
export const CONNECTING_GRACE_MS = 3_000;

export interface ConnectionBannerProps {
  kind: ConnectionBannerKind;
  /** The freshness of what is on screen, already formatted ("3m ago"), or null when this page load
   *  has never had a connection. The banner writes the sentence, never the clock. */
  lastSyncedAt?: string | null;
  /** `unreachable`'s button. Omitted, the banner states the situation and offers nothing. */
  onRetry?: () => void;
  /** `session`'s button — a stale token needs a new one, and the app only issues one at boot. */
  onReload?: () => void;
}

/** The line the banner says, or null when it says nothing. Pure, and separate from the element so
 *  the copy can be read in one place — including the two cases where the sentence is shorter
 *  because there is nothing to be honest about ("Showing what synced" with nothing ever synced is a
 *  claim about data that does not exist). */
export function connectionLine(
  kind: ConnectionBannerKind,
  lastSyncedAt: string | null,
  connectingSettled: boolean,
): string | null {
  switch (kind) {
    case "ok":
      return null;
    case "offline":
      return lastSyncedAt === null
        ? "You're offline."
        : `You're offline. Showing what synced ${lastSyncedAt}.`;
    case "unreachable":
      return lastSyncedAt === null
        ? "Can't reach omnis. Retrying…"
        : `Can't reach omnis. Showing what synced ${lastSyncedAt}. Retrying…`;
    case "session":
      return "Sync needs a fresh session.";
    case "connecting":
      return connectingSettled ? "Connecting to omnis…" : null;
  }
}

/** The shell's one line about sync. Chrome, so it is glass (DESIGN-DIRECTION-v3 §e.4); the list
 *  under it stays opaque. `role="status"` with `aria-live="polite"` because the line changes on its
 *  own — a connection dropping is not an answer to anything the user just did, and interrupting them
 *  for it would be wrong. Nothing here moves focus, so the button is reached by Tab like any other
 *  control. */
export function ConnectionBanner({
  kind,
  lastSyncedAt = null,
  onRetry,
  onReload,
}: ConnectionBannerProps) {
  const [connectingSettled, setConnectingSettled] = useState(false);

  // One timer, keyed on the kind: leaving `connecting` and coming back restarts the grace period
  // rather than inheriting the earlier one's.
  useEffect(() => {
    if (kind !== "connecting") {
      setConnectingSettled(false);
      return;
    }
    const timer = window.setTimeout(() => setConnectingSettled(true), CONNECTING_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [kind]);

  const line = connectionLine(kind, lastSyncedAt, connectingSettled);
  if (line === null) return null;

  const action =
    kind === "unreachable" && onRetry !== undefined
      ? { label: "Retry now", onClick: onRetry }
      : kind === "session" && onReload !== undefined
        ? { label: "Reload", onClick: onReload }
        : null;

  return (
    <GlassSurface
      slot="toolbar"
      className="connection-banner"
      data-kind={kind}
      // biome-ignore lint/a11y/useSemanticElements: GlassSurface is a div and cannot be an <output>, and the surface is the brief's — the role is what carries the "this changes on its own" semantics.
      role="status"
      aria-live="polite"
    >
      {/* Decoration: the sentence already says which state this is. */}
      <span className="connection-banner__dot" aria-hidden="true" />
      <span className="connection-banner__text">{line}</span>
      {action !== null && (
        <button type="button" className="connection-banner__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </GlassSurface>
  );
}
