import { InboxSkeleton } from "../screens/Inbox.js";

/** loop-r2-05: what the window shows while the boot is still waiting for a Zero token.
 *
 *  Before this, `main.tsx` awaited `loadZeroToken()` before its first `createRoot` — with the hub
 *  down that is a `fetch` that hangs until the socket gives up, and the document was blank white for
 *  the whole of it (measured: still white after 8s, both widths). Nothing was mounted to be slow;
 *  there was nothing to mount.
 *
 *  So this is the smallest thing that is honestly the app: the shell's own classes, in the place the
 *  shell would put them, so the boot does not move when the real tree replaces it. The rail is its
 *  column and nothing else — a rail with placeholder tiles would be inventing content, and the
 *  column's width is the only part of it the list's position depends on. The list is the real
 *  skeleton (InboxSkeleton), the same eight rows the Inbox draws while its query has not answered,
 *  which is also the state this boot lands in whenever the token never arrives.
 *
 *  aria-busy + one spoken line, and no spinner: the deadline is 4s, and a spinner that appears and
 *  vanishes in under a second draws the eye to nothing.
 */
export function BootSkeleton() {
  return (
    <div className="app-shell" aria-busy="true">
      <div className="channel-rail" aria-hidden="true" />
      <div className="app-shell__main">
        {/* Nothing in here is content, so the whole card is out of the accessibility tree and the
            one thing a screen reader should hear is the label below. */}
        <div className="inbox-card" aria-hidden="true">
          <div className="inbox-card__header">
            {/* The card's own 28px title bar. The real header is taller — it carries an h2 and a
                subline — but this is the boot, both it and the rows are replaced in the same frame,
                and a placeholder padded out to the taller header would make the swap *more*
                visible rather than less. */}
            <span className="boot-skeleton__title" />
          </div>
          <div className="inbox-card__list inbox-card__list--skeleton">
            <InboxSkeleton />
          </div>
        </div>
      </div>
      <p className="visually-hidden">Loading omnis…</p>
    </div>
  );
}
