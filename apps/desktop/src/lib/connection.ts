/** loop-r2-05: the app's one answer to "can this window see the hub, and how fresh is what it is
 *  showing". Before this there were three partial answers that disagreed with each other — Today
 *  read `zero.online` and drew its own "You're offline" line, the Inbox's subline said "Updated now"
 *  whether or not anything had synced, and nothing at all noticed the browser going offline. One
 *  source, read once by the shell, is what makes the banner and the header tell the same story.
 *
 *  It is deliberately *not* a store: `Connection` is derived on every render from two subscriptions
 *  the platform already owns, and the only thing this module remembers is when the last successful
 *  connection began. */
import { useConnectionState } from "@rocicorp/zero/react";
import { useEffect, useSyncExternalStore } from "react";
import { hasZeroToken } from "../zero-client.js";

/** The five things the shell can be looking at. `ok` is the only one the banner draws nothing for.
 *  - `offline` — the browser itself is offline (`navigator.onLine`). The network is gone, not omnis.
 *  - `unreachable` — the network is up and Zero cannot hold a connection: no token, or Zero is
 *    `disconnected` / `error` / `closed`. Everything on screen is whatever synced last.
 *  - `session` — Zero says `needs-auth`: the token expired and nothing retries until the app
 *    reconnects with a new one.
 *  - `connecting` — Zero is on its way up (a normal start passes through this).
 *  - `ok` — Zero is `connected`. */
export type ConnectionKind = "ok" | "connecting" | "offline" | "unreachable" | "session";

export interface Connection {
  kind: ConnectionKind;
  /** When the last connection to the hub began, or null if this page load never had one. A reload
   *  starts at null on purpose: a timestamp in storage would outlive the data it describes. */
  lastSyncedAt: number | null;
}

/** Zero 1.9.0's `ConnectionState["name"]` (`zero-client/src/client/connection.d.ts:18`). Spelled out
 *  here rather than imported so the mapping below is total and a future state is a compile error
 *  instead of a silent fallthrough. */
export type ZeroConnectionName =
  | "connecting"
  | "connected"
  | "disconnected"
  | "needs-auth"
  | "error"
  | "closed";

/** The rules, in order. Order is the whole logic: `offline` outranks a dead socket (the network is
 *  the more specific fact), and a missing token outranks `connecting` (nothing is connecting — Zero
 *  was built without auth and will never try).
 *
 *  A pure function so the mapping can be tested without a browser, a socket or a Zero instance. */
export function connectionKind(input: {
  online: boolean;
  zeroName: ZeroConnectionName;
  hasToken: boolean;
}): ConnectionKind {
  if (!input.online) return "offline";
  if (
    !input.hasToken ||
    input.zeroName === "disconnected" ||
    input.zeroName === "error" ||
    input.zeroName === "closed"
  ) {
    return "unreachable";
  }
  if (input.zeroName === "needs-auth") return "session";
  if (input.zeroName === "connecting") return "connecting";
  return "ok";
}

/** The time the current connection began, module-level because it is a fact about the page rather
 *  than about any component: the banner is not the only thing that may want it, and a value in React
 *  state would be a second copy of it.
 *
 *  Written from an effect rather than during render — a render must not have side effects, and the
 *  effect's timing is exactly right: it runs after the commit in which Zero became `connected`, so
 *  the next render (whatever it is) reads a value already set. Nothing has to re-render on the write
 *  itself: while Zero is `connected` the banner draws nothing and the header is allowed to say
 *  "Updated". */
let lastSyncedAt: number | null = null;
let lastZeroName: ZeroConnectionName | null = null;

/** `navigator.onLine` as a store, with the two window events as its subscription. There is no
 *  polling: the browser already knows, and it says so. */
function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** True while rendering where there is no window (the test renderer's server snapshot): assuming
 *  online is the quieter assumption — offline would paint a banner into every test render. */
function serverOnline(): boolean {
  return true;
}

export function useConnection(): Connection {
  const zero = useConnectionState();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, serverOnline);
  const zeroName = zero.name;

  useEffect(() => {
    if (zeroName === "connected" && lastZeroName !== "connected") lastSyncedAt = Date.now();
    lastZeroName = zeroName;
  }, [zeroName]);

  return {
    kind: connectionKind({ online, zeroName, hasToken: hasZeroToken() }),
    lastSyncedAt,
  };
}
