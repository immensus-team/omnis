import {
  type ApprovalCardDecision,
  ApprovalStack,
  type ApprovalStackItem,
  BottomBar,
  ChannelRail,
  CommandPalette,
  type CommandPaletteSearch,
  ConnectionBanner,
  DETAIL_COLLAPSED_KEY,
  DETAIL_DEFAULT_WIDTH,
  DETAIL_WIDTH_KEY,
  DetailPaneBack,
  DetailPaneClose,
  DetailPaneHandle,
  DetailPaneToggle,
  DrawerGrabber,
  LEAVE_MS,
  NarrowDrawer,
  type PaletteAction,
  type RailScreen,
  type RailSelection,
  TOAST_MS,
  type ToastRequest,
  type UiChannel,
  type UiSearchGroup,
  type UiSearchHit,
  clampDetailWidth,
  readDetailCollapsed,
  readDetailWidth,
  toast,
  useClosingSpring,
  useFloatingPane,
  useNarrowShell,
} from "@omnis/ui";
import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
import { ZeroProvider, useConnectionState, useQuery } from "@rocicorp/zero/react";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { approvalDecideUrl, decideApproval } from "./api/approvals.js";
import { type SearchHit, search, toUiSearchGroups } from "./api/search.js";
import { fetchSettings, putSetting } from "./api/settings.js";
import { isEditableTarget, isInsideOverlay, useKeymap } from "./hooks/use-keymap.js";
import { useConnection } from "./lib/connection.js";
import { AgentSession } from "./screens/AgentSession.js";
import { Digest } from "./screens/Digest.js";
import { Inbox, type OpenTarget } from "./screens/Inbox.js";
import { Network, PersonDetail } from "./screens/Network.js";
import { Notes } from "./screens/Notes.js";
import { Settings } from "./screens/Settings.js";
import { Tasks } from "./screens/Tasks.js";
import { Thread } from "./screens/Thread.js";
import { Today } from "./screens/Today.js";
import { initZero, useZeroClient } from "./zero-client.js";

/** loop-r1-06 in S6's vocabulary: the app raises ONE toast at a time, and this is its name. sonner
 *  keys a toast by id, so raising another with this id updates the one on screen — the whole of "one
 *  slot, no queue" — and dismissing it by id is how a taken undo takes the toast down. */
const TOAST_SLOT_ID = "omnis-toast-slot";

// Created at module scope it would open a WebSocket on import alone — deferred to first render.
let zeroClient: ReturnType<typeof initZero> | undefined;
function getZero() {
  zeroClient ??= initZero();
  return zeroClient;
}

/** loop-r2-05: the banner's freshness word. The formatter is the same one the Inbox subline reads
 *  ("3m", "2h", "just now"), and the sentence around it is the banner's, so what the shell adds
 *  here is only the " ago" — with no second suffix on a time that is already "now". */
function syncedAgo(timestampMs: number): string {
  const relative = formatRelativeTime(timestampMs);
  return relative === "now" ? "just now" : `${relative} ago`;
}

/** The banner's two buttons both end here in the cases Zero cannot fix (see `onRetry`): a token is
 *  issued by `loadZeroToken` at boot and nowhere else, so the only way to get a fresh one is to run
 *  the boot again. Module scope for a stable identity — the banner takes it as a prop. */
function reloadPage(): void {
  window.location.reload();
}

/** The other half of A5 §2.4's go-to pair. The letters live in hooks/use-keymap.ts (GOTO_KEYS:
 *  `i` → `go-inbox`, …) next to the rest of the map; this is what those action names mean to the
 *  shell, and it is the only place that reads them. */
const GO_TO_SCREENS: Record<string, ShellScreen> = {
  "go-inbox": "inbox",
  "go-today": "today",
  "go-tasks": "tasks",
  "go-network": "network",
  "go-notes": "notes",
  "go-digest": "digest",
  "go-settings": "settings",
};

/** A5 §2.4's keymap (useKeymap) deliberately ignores input with modifier keys, so Cmd+K is handled
 *  by the shell itself. */
function useCommandPaletteKey(toggle: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}

/** US-D10: the pane's own key. Cmd+\ rather than `[` / `]` — A5 §2.4's keymap reserves neither, but
 *  it is built for unmodified keys and the shell already owns the modified ones, so this sits beside
 *  Cmd+K instead of reaching into a shared map. `code` as well as `key`: on a layout where the
 *  backslash is elsewhere the label still says what to press.
 *
 *  Disabled below 900, where the pane is a full-width sheet with no toggle to press — a shortcut
 *  that silently rewrites a setting it cannot show is worse than one that does nothing. */
function useDetailPaneKey(toggle: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== "\\" && e.code !== "Backslash") return;
      e.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, enabled]);
}

/** The shell's own width. Not a ResizeObserver on the element: `#root` is the shell's containing
 *  block and nothing inside the app can change it, so the window is the box with the listener.
 *  This is the pane's ceiling (half the shell), and it has to be a number JS can read — the drag
 *  clamps against it on every frame. */
function useShellWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/** The screens the shell can show. The rail switches between them by screen, not by route —
 *  there is no URL router in the desktop app (src-tauri loads one documents).
 *
 *  An alias of the rail's own type rather than a second list: the tiles are what name the screens,
 *  and packages/ui cannot import from an app, so the type lives there and the shell borrows it. */
export type ShellScreen = RailScreen;

export function App({ screen = "inbox" }: { screen?: ShellScreen }) {
  // Without ZeroProvider, useQuery dies with "useZero must be used within a ZeroProvider".
  return (
    <ZeroProvider zero={getZero()}>
      <Shell initialScreen={screen} />
    </ZeroProvider>
  );
}

function Shell({ initialScreen }: { initialScreen: ShellScreen }) {
  // The screen is shell state, not a prop: every way of changing it (a rail tile, `g` + a letter,
  // a palette action) goes through goTo below, and a prop that the shell then re-assigns would be
  // two owners for one value. The prop the shell is handed is where it *starts*.
  const [screen, setScreen] = useState<ShellScreen>(initialScreen);
  const zero = useZeroClient();
  /** loop-r2-05: one source for "can this window see omnis" (lib/connection.ts), drawn once by the
   *  banner below and read once more by the Inbox's subline — before this, the Inbox said "Updated
   *  now" and Today said "You're offline" about the same socket at the same moment.
   *
   *  Zero's own state is read a second time here rather than folded into `connection`, because the
   *  banner's Retry button needs the raw name: `connection.kind` has already collapsed `error` and
   *  `needs-auth` into `unreachable` and `session`, and those two are exactly the cases Zero's
   *  `connect()` answers (it "does not reconnect from `disconnected` or `closed`"). */
  const connection = useConnection();
  const zeroConnection = useConnectionState();
  const [open, setOpen] = useState<OpenTarget | null>(null);
  // US-B30: a person is not a thread, so the detail pane's target is its own state rather than a
  // second variant on OpenTarget — the pane draws PersonDetail or Thread, never a mix, and one
  // nullable string says that more plainly than a discriminated union with two members.
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  /** loop-r1-02/L-04: the user asked for the approval queue. A second target beside `open` and
   *  `openPersonId` because it is a third thing the pane can be showing — the queue with no thread
   *  behind it — and folding it into `open` would mean inventing a "null thread" variant of a type
   *  that means "a thread". Below 1280 it is the *only* thing that opens the pane on the queue. */
  const [queueOpen, setQueueOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [railChannel, setRailChannel] = useState<RailSelection>(null);
  // US-D09 §c.6: the BottomBar's filters circle opens M125's sheet, and the sheet edits the list's
  // own filter state — so the open flag lives here (the trigger is in this file's bar) while the
  // rows live in Inbox.tsx (which owns what they change).
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** Set when the user pulls the narrow pane's drawer away. Below 900 the pane has no toggle to
   *  collapse it, so that gesture *is* the decision the collapse flag is above — and it has to be
   *  remembered separately, because the reason the pane opened on its own (the inbox's pending
   *  approvals, see `paneVisible`) is still true a frame later and would spring the drawer back up.
   *  An explicit open outranks it: see the effect below. */
  const [paneDismissed, setPaneDismissed] = useState(false);
  // US-D08 §c.9: below 900 the ask bar leaves the top of the list and becomes the BottomBar's
  // middle piece. One element in one of two places, never both — a second render of the palette
  // would be a second cmdk list, a second action list to keep in sync, and two things answering
  // Cmd+K.
  const narrow = useNarrowShell();
  // US-D10: the tier where the pane has no column of its own — <=1279.98, the floating sheet. The
  // pane Is a sheet there whatever its collapse state; >=1280 it is a column unless the user has
  // collapsed it, in which case it has no column either.
  const floating = useFloatingPane();
  const [storedWidth, setStoredWidth] = useState<number | null>(null);
  /** The width a *gesture* is drawing, and null whenever no gesture is running. Kept apart from
   *  `storedWidth` because the two are clamped differently: a width the user has settled on is
   *  always inside the range, while the band the drag reports past the limits is deliberately
   *  outside it. Clamping this one on the way to the DOM — which is what the shell used to do —
   *  computes a rubber band and then throws it away, so the pane followed the pointer one-for-one
   *  to the limit and stopped dead there. */
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const shellWidth = useShellWidth();
  /** Set the first time the user arranges the pane themselves — a press, a drag, a reset.
   *
   *  The restore below is a round trip, and the answer to it must not land on top of a decision made
   *  while it was in the air: the user collapses the pane, the read the shell sent before that
   *  arrives, and the pane springs back open for no reason they can see. Latent in a real browser
   *  (the hub answers in milliseconds) and ordinary in a test, which is how it was found. */
  const arranged = useRef(false);
  /** loop-r1-02/NC-09: the thread whose row Escape should put the focus back on, once the close has
   *  been committed. A ref rather than state because it is not something the shell renders — it is a
   *  message to the effect below, which runs after the render that took the pane away. */
  const focusRowForThread = useRef<string | null>(null);

  // Restored once, at the same moment the Zero socket opens (App follows the same rule): the hub is
  // not necessarily up yet, and `fetchSettings` answers with an empty object rather than failing, so
  // an unanswered read draws the default pane — which is what a fresh install sees.
  useEffect(() => {
    let live = true;
    void fetchSettings().then((settings) => {
      if (!live || arranged.current) return;
      setStoredWidth(readDetailWidth(settings[DETAIL_WIDTH_KEY]));
      setCollapsed(readDetailCollapsed(settings[DETAIL_COLLAPSED_KEY]));
    });
    return () => {
      live = false;
    };
  }, []);
  // US-D01 decision: Cmd+K opens the ask bar's floating AI panel rather than a separate modal
  // palette. Putting the same action list on two surfaces (modal + panel) leaves no way to tell
  // which is the real one, so they are merged into one.
  // CommandPalette mode="dialog" itself stays in @omnis/ui with its tests — the shell just does
  // not use it.
  // (The binding itself is below `paneVisible`: in the narrow tier it has to know whether a drawer
  // is already up.)

  // Approvals are read through Zero (the read-only path) and only the decision goes to the hub
  // over HTTP — contract §5.
  const [approvals] = useQuery(zero.query.pending_approvals.where("state", "=", "pending"));
  const [accounts] = useQuery(zero.query.accounts);

  /** loop-r1-06: the one thing the shell says back after a write. Until this existed a decision
   *  answered with nothing at all — the row slid away, the card silently became the next one — and a
   *  write that *failed* answered with even less.
   *
   *  S6 gave the app a toast library (packages/ui's `Toaster`, mounted once in main.tsx) and the
   *  merge kept it: the pill this used to render was a second surface for the same job, so `notify`
   *  is now the one place that turns a `ToastRequest` into sonner's own options — including the
   *  identity below, which is what makes "one slot, no queue" true for the library too. Nothing
   *  about *what* is said moved: the raisers (this file's decisions, the Inbox's archives) still
   *  name a message and an action and nothing else. */
  /** The work a toast is holding back until it goes away, and (for the ignore) the approval the
   *  `beforeunload` beacon would have to re-send. Only the ignore defers a hub call today: its whole
   *  point is that the user may take it back, so the decision waits for the toast to leave. */
  const held = useRef<{ run: () => void; ignoreId?: string } | null>(null);

  /** The toast is going — by its own timer, by a swipe, or by the user's close button. Running the
   *  held work is what every one of those means, and the ref is cleared first so that two of them
   *  arriving in either order still run it once. */
  /** Takes the toast down without running what it held. The ignore's Undo is the caller: the
   *  decision has just been taken back, so the work the toast was deferring is dropped rather than
   *  run. The dismissal still routes through `onDismiss` like any other, which is `runHeld` — and
   *  `held` is empty by then, so nothing runs twice. */
  const dismissToast = useCallback(() => toast.dismiss(TOAST_SLOT_ID), []);

  const runHeld = useCallback(() => {
    const outgoing = held.current;
    held.current = null;
    outgoing?.run();
  }, []);

  /** Raises a toast, and hands it the work it should hold back. The toast being replaced finishes
   *  that work first — "replaced by another toast" and "timed out" are the same event for anything
   *  deferred — and it runs *before* the new toast is armed, so the new slot is not what the
   *  outgoing work finds when it looks. (A deferred run must therefore not raise a toast
   *  synchronously; the one that does raises it from a promise's `catch`.)
   *
   *  The action is wrapped rather than passed through, so that taking the action calls the deferred
   *  work off: an Undo on the ignore means the ignore is not sent, whichever screen put the button
   *  there. No caller has to remember that. */
  const notify = useCallback(
    (spec: ToastRequest, deferred?: { run: () => void; ignoreId?: string }) => {
      // The toast being replaced finishes that work first — "replaced by another toast" and "timed
      // out" are the same event for anything deferred — and it runs *before* the new slot is armed,
      // so the outgoing work does not find the new toast when it looks.
      runHeld();
      held.current = deferred ?? null;
      const action = spec.action;
      toast(spec.message, {
        // One slot: a toast raised while another is up updates it in place rather than stacking a
        // second one. sonner re-arms the dwell when it does, which is what makes two archives in a
        // row two full windows rather than the tail of one.
        id: TOAST_SLOT_ID,
        duration: TOAST_MS,
        action:
          action === undefined
            ? undefined
            : {
                label: action.label,
                // Wrapped rather than passed through, so that taking the action calls the deferred
                // work off: an Undo on the ignore means the ignore is not sent, whichever screen put
                // the button there. No caller has to remember that.
                //
                // `preventDefault` is load-bearing. sonner dismisses the toast itself after an
                // action click unless the press says otherwise (dist's `onClick` for `data-action`),
                // and a dismissal runs the handlers below — so pressing Undo, which raises the toast
                // for the write it just made, would fire that brand-new toast's deferred work on the
                // same tick and disarm the undo the user is looking at. Cancelling the press leaves
                // the toast up, showing what the undo did, for its own full window.
                onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
                  event.preventDefault();
                  held.current = null;
                  action.onAction();
                },
              },
        onDismiss: runHeld,
        onAutoClose: runHeld,
      });
    },
    [runHeld],
  );

  /** loop-r1-06: `/approvals/:id/decide` re-sent as the window closes. A fetch would be cancelled
   *  with the document, so the deferred ignore goes out as a beacon instead — same route, same JSON
   *  body (the hub parses the body, not the request's content type). Best effort by construction:
   *  the browser may drop it, and the approval then simply stays pending. */
  useEffect(() => {
    function onBeforeUnload() {
      const ignoreId = held.current?.ignoreId;
      if (ignoreId === undefined) return;
      navigator.sendBeacon(
        approvalDecideUrl(ignoreId),
        new Blob([JSON.stringify({ decision: "ignore" })], { type: "application/json" }),
      );
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  /** loop-r1-06: the approvals that are still on screen. A card that has just been decided or
   *  ignored is taken out here rather than waiting for the hub and Zero to agree — and *everything*
   *  that reads the queue reads this list, so a hidden card cannot vanish from the pane's stack
   *  while surviving in the subline's count. */
  const [hiddenApprovalIds, setHiddenApprovalIds] = useState<ReadonlySet<string>>(new Set());
  const visibleApprovals = useMemo(
    () => (approvals as unknown as ApprovalStackItem[]).filter((a) => !hiddenApprovalIds.has(a.id)),
    [approvals, hiddenApprovalIds],
  );
  /** loop-r2-02: the *items* those hidden approvals were about, which is what the thread view needs.
   *  A hidden approval is one whose draft it was folding; without this the draft would stop folding
   *  for the length of the undo window and redraw as a standalone DraftCard — the card the person
   *  just dismissed, one frame after it left. Read off the full `approvals` list rather than
   *  `visibleApprovals`, which by definition no longer contains them. */
  const heldItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of approvals as unknown as ApprovalStackItem[]) {
      if (hiddenApprovalIds.has(a.id) && typeof a.item_id === "string") ids.add(a.item_id);
    }
    return ids;
  }, [approvals, hiddenApprovalIds]);

  // US-D01: the selected thread's AI summary (threads.meta.summary, filled by the T1 summary loop
  // in packages/agents). No new backend call is needed — it is the same query shape Thread.tsx
  // uses to read archived_at. With nothing selected it queries the empty string (an empty result),
  // because the number of hooks cannot be made conditional.
  const [selectedThreadRows] = useQuery(zero.query.threads.where("id", "=", open?.threadId ?? ""));
  const selectedThread = (
    selectedThreadRows as unknown as {
      title?: string | null;
      meta?: { summary?: string } | null;
    }[]
  )[0];
  const selectedThreadSummary = selectedThread?.meta?.summary ?? null;
  const selectedThreadTitle = selectedThread?.title ?? null;

  // A5 §3.5: a task's source message deep-links to its Thread. The task row carries the *item*, not
  // the thread, and Zero has no relationship to walk between the two — so the item is fetched by id
  // when a source is clicked, and the thread it names is what opens. The id is cleared once it has
  // been resolved so a later click on the same source re-triggers it.
  const [sourceItemId, setSourceItemId] = useState<string | null>(null);
  const [sourceItemRows] = useQuery(zero.query.items.where("id", "=", sourceItemId ?? ""));
  const sourceThreadId = (sourceItemRows as unknown as { thread_id?: string }[])[0]?.thread_id;
  useEffect(() => {
    if (sourceItemId !== null && sourceThreadId !== undefined) {
      setOpen({ threadId: sourceThreadId, agentSession: false });
      setSourceItemId(null);
    }
  }, [sourceItemId, sourceThreadId]);

  // U1 channel rail: the connected accounts' channels, de-duplicated, in order of first
  // appearance.
  const connectedChannels = useMemo(() => {
    const seen = new Set<UiChannel>();
    const list: UiChannel[] = [];
    for (const a of accounts) {
      const channel = a.channel as UiChannel;
      if (!seen.has(channel)) {
        seen.add(channel);
        list.push(channel);
      }
    }
    return list;
  }, [accounts]);

  // The stack hands back the id it decided on (it renders one card per approval, so the card
  // itself no longer knows which one it is).
  //
  // loop-r1-06: every decision the user can see now answers back. The card leaves the queue on the
  // click rather than on the hub's reply — a card that sits there for a round trip reads as a click
  // that did nothing — and what the toast says depends on what was actually decided:
  //
  //   accept / edit — a confirmation, no Undo. These are writes that have already been made:
  //                   the draft is in the outbox and the reply may be on its way out. An Undo button
  //                   there would be a button that lies, which is worse than no button at all.
  //   ignore        — an Undo, and the hub is not told until the toast goes. This is the one
  //                   decision with a delay to spend, because nothing downstream has happened yet.
  //   respond       — nothing. The draft is sent and the conversation shows it; a toast would be
  //                   the third time the same fact was reported.
  const onDecide = useCallback(
    function decide(
      id: string,
      decision: ApprovalCardDecision,
      decidedArgs?: Record<string, unknown>,
    ) {
      if (decision === "respond") {
        void decideApproval(id, decision, decidedArgs);
        return;
      }
      const description =
        visibleApprovals.find((a) => a.id === id)?.description.replace(/\?$/, "") ?? "";
      setHiddenApprovalIds((ids) => new Set(ids).add(id));
      const unhide = () =>
        setHiddenApprovalIds((ids) => {
          if (!ids.has(id)) return ids;
          const next = new Set(ids);
          next.delete(id);
          return next;
        });

      if (decision === "ignore") {
        notify(
          {
            message: `Ignored: ${description}`,
            action: {
              label: "Undo",
              onAction: () => {
                unhide();
                dismissToast();
              },
            },
          },
          {
            ignoreId: id,
            run: () => {
              void decideApproval(id, "ignore").catch(() => {
                unhide();
                notify({
                  message: "Approval didn't go through.",
                  action: { label: "Retry", onAction: () => decide(id, "ignore") },
                });
              });
            },
          },
        );
        return;
      }

      void decideApproval(id, decision, decidedArgs)
        .then(() => notify({ message: `Approved: ${description}` }))
        .catch(() => {
          unhide();
          notify({
            message: "Approval didn't go through.",
            action: { label: "Retry", onAction: () => decide(id, decision, decidedArgs) },
          });
        });
    },
    [visibleApprovals, notify, dismissToast],
  );

  // A5 §3.4: a briefing item on Today deep-links to its Thread — the one navigation that screen
  // does (the approvals stay inline, so the detail pane opens only for this).
  const openThread = useCallback((threadId: string) => {
    setOpen({ threadId, agentSession: false });
  }, []);

  // Opening a conversation from a person's timeline replaces the person in the pane rather than
  // stacking a second view under them: at 1440 the pane is one column, and a thread pushed below a
  // person would be a conversation read through someone else's file card.
  const openThreadFromPerson = useCallback((threadId: string) => {
    setOpenPersonId(null);
    setOpen({ threadId, agentSession: false });
  }, []);

  /** The one way the screen changes, whichever control asked for it. It clears the pane's targets
   *  with it: a thread or a person open in the pane belongs to the screen you were looking at, and
   *  leaving it open would draw someone else's screen around it. The channel filter goes back to
   *  "everything" only on the way *to* the Inbox, which is what `go-inbox` has always done — coming
   *  back from Settings to the Slack view you left is the behaviour the tile's own press describes. */
  const goTo = useCallback((next: ShellScreen) => {
    setScreen(next);
    setOpen(null);
    setOpenPersonId(null);
    if (next === "inbox") setRailChannel(null);
  }, []);

  // A5 §2.4's go-to half of the keymap. Inbox.tsx registers its own for the row actions (archive,
  // unarchive, …) and the two handle disjoint action names, so `g` followed by a letter resolves
  // here and a bare `e` there, with neither hook needing to know about the other.
  useKeymap(
    useCallback(
      (action: string) => {
        const target = GO_TO_SCREENS[action];
        if (target !== undefined) goTo(target);
      },
      [goTo],
    ),
  );

  // US-B27: the palette's search mode. The palette owns the 180ms debounce and hands back the
  // settled query; the request itself is hub HTTP (contract §5) — search reads across tables Zero
  // does not replicate. `gen` drops a response that a newer keystroke has already superseded.
  const [results, setResults] = useState<{ groups: UiSearchGroup[]; loading: boolean }>({
    groups: [],
    loading: false,
  });
  const gen = useRef(0);
  // The palette's hit carries no deep_link (it is a UI-level type), so the response is kept here to
  // route a selected hit to its screen.
  const hits = useRef(new Map<string, SearchHit>());
  const runSearch = useCallback((q: string) => {
    gen.current += 1;
    const request = gen.current;
    if (q.trim() === "") {
      setResults({ groups: [], loading: false });
      return;
    }
    setResults((prev) => ({ ...prev, loading: true }));
    search(q)
      .then((response) => {
        if (request !== gen.current) return;
        hits.current = new Map(
          response.groups.flatMap((g) => g.results.map((r) => [`${r.kind}:${r.id}`, r])),
        );
        setResults({ groups: toUiSearchGroups(response), loading: false });
      })
      .catch((error: unknown) => {
        if (request !== gen.current) return;
        // A failed search is not worth a banner across the list: the palette reads "No results",
        // which is the state the user can act on. The reason stays in the console.
        console.error("search failed", error);
        setResults({ groups: [], loading: false });
      });
  }, []);

  // Deep links the shell can follow: the thread route, and (loop-r1-08/L-15, NC-12) the person one
  // the hub has been sending all along. A memory's deep link carries an item id but no thread id,
  // so a memory row is shown and not followed yet.
  //
  // The person branch clears `open` rather than stacking: the pane draws one of PersonDetail or
  // Thread, never a mix, and a person opened over a thread would be read through that thread's
  // context (the same reason openThreadFromPerson clears `openPersonId`).
  const openHit = useCallback((hit: UiSearchHit) => {
    const link = hits.current.get(`${hit.kind}:${hit.id}`)?.deep_link;
    if (link === undefined || link === null) return;
    if (link.screen === "person" && link.person_id !== undefined) {
      setOpen(null);
      setOpenPersonId(link.person_id);
      setAskOpen(false);
      return;
    }
    if (link.screen !== "thread" || link.thread_id === undefined) return;
    setOpen({ threadId: link.thread_id, agentSession: false });
    setAskOpen(false);
  }, []);

  const paletteSearch: CommandPaletteSearch = useMemo(
    () => ({
      groups: results.groups,
      loading: results.loading,
      onQueryChange: runSearch,
      onSelectHit: openHit,
    }),
    [results, runSearch, openHit],
  );

  // The kinso reference has only a rail and a main column — the detail pane opens a third column
  // only when there is something to look at. (Keeping an empty pane open shrinks the Inbox card
  // into a sidebar taking a third of the window.)
  //
  // US-B28: Today draws the pending-approval queue inline — a chip expands its card in place, with
  // no navigation (A5 §3.4) — so only the Inbox's own queue auto-opens the pane. Opening it on
  // Today's account would draw the same approvals twice on one screen, and at 390 the sheet would
  // cover the screen it duplicates.
  //
  // US-D10 narrows that further: below 900 the pane is a full-width sheet and there is no toggle to
  // press, so the user's collapse flag does not apply there — the tier keeps the behaviour it had.
  const paneCollapsed = collapsed && !narrow;
  // loop-r1-02/L-04, L-17, NC-03: the queue auto-opens in the **column** tier only. Below 1280 the
  // pane is a floating sheet, and a sheet that opens itself on every load is not a pane — at 390 it
  // was a full-height overlay with no way out, so the inbox could not be reached until every
  // approval had been decided, and at 900–1279 it floated over about 40% of the list the user was
  // trying to read. Apple Mail never opens a sheet on its own (DESIGN-DIRECTION-v3 §c.6, §c.9); the
  // list comes first and the queue is asked for, through the subline's "N need approval" button.
  // `!floating` is therefore part of the condition and not a tier branch somewhere below: it is the
  // same fact — whether the pane would be a column — that decides whether it may open unasked.
  //
  // Collapsed, only a target the user asked for opens the pane, in either tier. The queue is *why*
  // the pane auto-opens when nobody asked; a pane the user has collapsed must not re-open itself
  // for it. `queueOpen` is not subject to either guard: it *is* the user asking.
  const paneVisible =
    open !== null ||
    openPersonId !== null ||
    queueOpen ||
    // loop-r1-06: `visibleApprovals`, not `approvals` — an ignored card must not hold the pane open
    // for the round trip it no longer needs, and on a one-approval inbox that is the difference
    // between the pane closing on the click and the pane closing five seconds later.
    // loop-r1-02/S5: `!floating` is main's half of this rule — below 1280 an approval must not open
    // the pane on its own, which at 390 is what kept the inbox unreachable until the queue was
    // empty. `!paneDismissed` is motion's: below 900 the pane is a drawer, and a drawer the user has
    // dragged away stays away rather than springing back from the approval that opened it.
    (!floating &&
      !paneCollapsed &&
      !paneDismissed &&
      screen === "inbox" &&
      visibleApprovals.length > 0);
  // An explicit target is a newer decision than a dismissal, so it releases it. An effect rather
  // than a wrapper around every `setOpen` call: the render that carries the new target already
  // shows the pane whatever this flag says, so nothing is waiting on it to be right.
  useEffect(() => {
    if (open !== null || openPersonId !== null) setPaneDismissed(false);
  }, [open, openPersonId]);
  // Below 900 the ask panel is a drawer too, and `vaul`'s drawer is modal: its scrim covers the
  // shell, and Cmd+K is a window listener that no scrim can intercept. So the tier is what keeps a
  // second drawer from stacking on the one already up. Above 900 the pane is a column and the
  // shortcut is the panel's way in — which is why this is not simply `paneVisible`.
  useCommandPaletteKey(() => {
    if (narrow && (paneVisible || filtersOpen)) return;
    setAskOpen((v) => !v);
  });
  // The pane stays mounted while it leaves, because the close is animated and CSS cannot animate a
  // node React has already unmounted (lib/motion.ts — the same hold the ask panel uses).
  const closing = useClosingSpring(paneVisible, LEAVE_MS);
  const paneRendered = paneVisible || closing;
  // The shape the pane draws in. A collapsed pane has no column, so a thread opens as the floating
  // sheet instead — which is also what every tier below 1280 draws. While the pane *leaves* it keeps
  // the column's shape: the close animates the width the column is giving back, and a pane that
  // changed shape on the way out would animate the wrong way.
  const sheetShape = paneVisible && (floating || paneCollapsed);
  const columnShape = paneRendered && !sheetShape;
  // A stored width is kept as the user chose it and clamped against the window it is drawn in: 320px
  // to half the shell. A number picked on a wider screen is not rewritten by a narrower one — which
  // is also why `liveWidth` short-circuits the clamp rather than going through it (see above).
  const detailWidth =
    liveWidth ?? clampDetailWidth(storedWidth ?? DETAIL_DEFAULT_WIDTH, shellWidth);

  /** Writes one setting — and does not care whether the hub took it. A layout preference that fails
   *  to save leaves the session exactly as the user arranged it, which is the only thing the write
   *  was for. */
  const remember = useCallback((key: string, value: unknown) => {
    void putSetting(key, value).catch(() => {});
  }, []);

  /** loop-r1-02 §3: the one way the pane is put away, whichever control asked — the sheet's
   *  `‹ Inbox`, the floating tier's ✕, or Escape. All three clear every target, because the pane
   *  has three independent reasons to be on screen and clearing two of them leaves the third
   *  holding it open: the close would read as a button that does nothing. */
  const closePane = useCallback(() => {
    setOpen(null);
    setOpenPersonId(null);
    setQueueOpen(false);
  }, []);

  const onPaneToggle = useCallback(() => {
    arranged.current = true;
    const next = !collapsed;
    setCollapsed(next);
    // Collapsing puts the thread away with the pane. A collapsed pane has no column for the thread
    // to open into, so leaving the row selected would re-open the same thread as a sheet on the very
    // next render — the row click that follows is what brings it back.
    if (next) setOpen(null);
    remember(DETAIL_COLLAPSED_KEY, next);
  }, [collapsed, remember]);

  const onWidthCommit = useCallback(
    (width: number) => {
      arranged.current = true;
      // The gesture is over, so the live width goes with it: from here the pane is drawn from the
      // value that was just committed, which is the clamped one.
      setDragging(false);
      setLiveWidth(null);
      setStoredWidth(width);
      remember(DETAIL_WIDTH_KEY, width);
    },
    [remember],
  );

  /** A cancelled gesture draws nothing — the shell puts the pane back by dropping the live width,
   *  which lands on the stored one, which is where the press started. */
  const onWidthCancel = useCallback(() => {
    setDragging(false);
    setLiveWidth(null);
  }, []);

  useDetailPaneKey(onPaneToggle, !narrow);

  /** A5 §2.3 + loop-r1-08/L-16: the palette's own list. The seven Navigate rows are loop-r1-01's
   *  (each one names a screen the rail also has a tile for), and "Toggle detail pane" is here
   *  because the pane is otherwise only reachable by a chevron — a command list that omits the
   *  shortcut the shell already binds teaches nothing about it.
   *
   *  Built here rather than beside the other shell state because it closes over `onPaneToggle`:
   *  state read above, handed down below, and nothing between the two renders it. */
  const actions: PaletteAction[] = [
    {
      id: "go-inbox",
      name: "Go to Inbox",
      shortcut: "g i",
      group: "Navigate",
      perform: () => goTo("inbox"),
    },
    {
      id: "go-today",
      name: "Go to Today",
      shortcut: "g t",
      group: "Navigate",
      perform: () => goTo("today"),
    },
    {
      id: "go-tasks",
      name: "Go to Tasks",
      shortcut: "g k",
      group: "Navigate",
      perform: () => goTo("tasks"),
    },
    {
      id: "go-network",
      name: "Go to Network",
      shortcut: "g n",
      group: "Navigate",
      perform: () => goTo("network"),
    },
    {
      id: "go-notes",
      name: "Go to Notes",
      shortcut: "g o",
      group: "Navigate",
      perform: () => goTo("notes"),
    },
    {
      id: "go-digest",
      name: "Go to Digest",
      shortcut: "g d",
      group: "Navigate",
      perform: () => goTo("digest"),
    },
    {
      id: "go-settings",
      name: "Go to Settings",
      shortcut: "g s",
      group: "Navigate",
      perform: () => goTo("settings"),
    },
    {
      id: "toggle-detail-pane",
      name: "Toggle detail pane",
      shortcut: "⌘\\",
      group: "View",
      perform: onPaneToggle,
    },
  ];

  /** loop-r1-02 §4: Escape closes the pane, and the shell owns it rather than the pane.
   *
   *  Three surfaces can be showing at once and each has its own reason to want Escape: the
   *  ConfirmPrompt and the filters Sheet own it through `aria-modal` (Radix dismisses on it), and
   *  anything being typed into owns every key. So this stands down for both — `defaultPrevented`
   *  covers a handler that ran first and has already dealt with the press, the editable-target check
   *  covers the ask bar and a composer, and the `aria-modal` check is what keeps these two listeners
   *  from closing the pane *behind* an open prompt, which is the shape of the bug where one press
   *  appears to do two things.
   *
   *  At >=1280 with approvals pending the pane is still there when this returns — the auto-open rule
   *  above puts the queue back, which is exactly the "back to the queue" NC-09 asked for. Below 1280
   *  there is no auto-open, so the same press leaves the list at full width. One handler, two tiers'
   *  worth of behaviour, and neither is a special case here.
   *
   *  Capture, on `window` — and this is load-bearing, not a style choice. Radix's DismissableLayer
   *  (every HoverCard, the filters Sheet, the ConfirmPrompt) listens for Escape on `document` in the
   *  capture phase and calls `preventDefault()` when it dismisses. A bubble-phase listener here runs
   *  last in line and would never see a press Radix had claimed — and Radix claims one whenever the
   *  pointer happens to be resting on a row, because that row's hover card is then the highest open
   *  layer. Click a thread and press Escape without moving the mouse and the pane would simply not
   *  close. `window` capture is the earliest node there is, so this press is read before any Radix
   *  layer can take it; the two guards above are what keep it from then stealing a press that a real
   *  modal wanted. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (isEditableTarget(e.target)) return;
      // loop-r2-04: an overlay owns its own Escape and the press must not travel on to the pane
      // behind it. `isInsideOverlay` is the app's shared guard (hooks/use-keymap.ts). The two checks
      // after it are this listener's own: the ask bar is not a dialog, but the model menu inside it
      // is a layer and takes its own Escape, and below 900 the thread sheet *is* an `aria-modal`
      // drawer — there the press belongs to Radix's dismissal, which hands focus back to the row that
      // opened it, and the guard deliberately lets the sheet through as the document being read.
      if (isInsideOverlay(e.target)) return;
      if (e.target instanceof Element && e.target.closest(".ask-bar") !== null) return;
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      if (!paneVisible) return;
      // Read before the close: `open` is the target this press is putting away, and it is gone from
      // the next render onwards.
      focusRowForThread.current = open?.threadId ?? null;
      closePane();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [paneVisible, open, closePane]);

  /** The other half of the key above: the focus goes back to the row the thread was opened from.
   *  Without it Escape leaves the focus on `<body>` — the pane is gone and the control that had it
   *  went with it — so the next Tab starts from the top of the document and a keyboard user who was
   *  reading a thread has lost their place in the list. No dependency array: this has to run on the
   *  render that follows `closePane`, and the ref is the guard that keeps it from doing anything on
   *  every other one. */
  useEffect(() => {
    const threadId = focusRowForThread.current;
    if (threadId === null) return;
    focusRowForThread.current = null;
    const row = document.querySelector(`[data-thread-id="${threadId}"]`);
    if (row instanceof HTMLElement) row.focus();
  });
  // §c.5: a thread — not the approval queue, and not an agent session, which draws no toolbar —
  // owns the narrow tier's action-band when one is open. It is the same condition Thread.tsx uses
  // to decide whether to portal its floating bar, and it has to be, or the band would hold both the
  // pill and the bar.
  /** Below 900 the pane is a drawer and this is what its drag, its scrim and Escape call. Clearing
   *  the two targets is what closes a pane this shell opened for a thread or a person, and
   *  `queueOpen` goes with them — below 1280 the queue's own button is the tier's way in (loop-r1's
   *  NC-03 took the auto-open away there), and a dismissal that left the flag set would put the
   *  drawer straight back up on the next render. `paneDismissed` is the other half: the flag that
   *  closes a pane which opened *itself*, whose reason is still true on the next render. */
  const onPaneDismiss = useCallback(() => {
    setOpen(null);
    setOpenPersonId(null);
    setQueueOpen(false);
    setPaneDismissed(true);
  }, []);

  const threadOpen = open !== null && !open.agentSession;

  /** US-B27's search mode and US-D08 §c.9's two homes, in one element: the shell builds it once and
   *  renders it in exactly one of the two places below. */
  const askBar = (
    <CommandPalette
      mode="inline"
      open={askOpen}
      onOpenChange={setAskOpen}
      actions={actions}
      search={paletteSearch}
      threadSelected={open !== null}
      threadSummary={selectedThreadSummary}
      threadTitle={selectedThreadTitle}
    />
  );

  /** loop-r2-05: the shell's one line about sync. Zero's own `connect()` is the right call exactly
   *  when Zero is paused waiting for the app to hand it something — `error` and `needs-auth` — and
   *  useless in every other case: it does not reconnect a `disconnected` socket (1.9.0
   *  `connection.d.ts`; Zero already retries those on its own), and with no token at all there is
   *  nothing to reconnect *with*, because the token rides the client's constructor and only a boot
   *  can supply one. So the fallback is a reload, which re-runs that boot. */
  const onRetry = useCallback(() => {
    if (zeroConnection.name === "error" || zeroConnection.name === "needs-auth") {
      void zero.connection.connect();
      return;
    }
    reloadPage();
  }, [zero, zeroConnection.name]);

  /** Rendered in exactly one of the two places below, like `askBar` — directly under the ask bar at
   *  >=900, and the first thing in the list column at <900 (where the ask bar is the BottomBar's
   *  pill instead, and a banner inside a fixed bar would be the wrong surface). One element, one
   *  mount: there is never a second banner to keep in step. */
  const connectionBanner = (
    <ConnectionBanner
      kind={connection.kind}
      lastSyncedAt={connection.lastSyncedAt === null ? null : syncedAgo(connection.lastSyncedAt)}
      onRetry={onRetry}
      onReload={reloadPage}
    />
  );

  /** The list column's body: one screen at a time, and the Inbox is the default. The rail switches
   *  between them by screen — there is no URL router in the desktop app. */
  const screenBody =
    screen === "today" ? (
      <Today onOpenThread={openThread} />
    ) : screen === "network" ? (
      <Network onOpenPerson={setOpenPersonId} onOpenThread={openThreadFromPerson} />
    ) : screen === "notes" ? (
      // US-B31: no navigation leaves this screen — a note's target is a label, not a link (A5
      // §3.7), and the routing decision is taken in place.
      <Notes />
    ) : screen === "settings" ? (
      // US-B33: Settings is the one screen whose writes are the point of it — every edit goes to
      // the hub over HTTP (contract §5) and comes back, so nothing is passed in for it.
      <Settings />
    ) : screen === "digest" ? (
      // US-B32: restoring here is an undo of the night's auto-archive, not navigation — the
      // Thread header banner that would follow the restore is §3.2's story, so nothing is
      // passed in for it yet.
      <Digest />
    ) : screen === "tasks" ? (
      <Tasks
        onOpenSource={setSourceItemId}
        // tasks.delegated_session_id is the agent_session thread itself, which is what
        // AgentSession renders — the same route the Inbox uses for an agent session row.
        onOpenDelegation={(sessionId) => setOpen({ threadId: sessionId, agentSession: true })}
      />
    ) : (
      <Inbox
        onOpen={setOpen}
        channelFilter={railChannel}
        onChannelFilterChange={setRailChannel}
        filtersOpen={filtersOpen}
        onFiltersOpenChange={setFiltersOpen}
        // loop-r1-02 §2: the count is the whole queue, not the rows on screen — the subline says
        // what is waiting to be decided, and a list filtered to one channel still has all of them.
        pendingApprovals={visibleApprovals.length}
        onOpenApprovals={() => setQueueOpen(true)}
        // loop-r2-05: the subline's "Updated 3m ago" is a freshness claim, and it is only true
        // while the connection is. When it is not, the banner above says what actually happened
        // and the subline drops that segment rather than contradicting it.
        connectionOk={connection.kind === "ok"}
        // loop-r1-06: the toast slot lives here, not in the screen, so that "Archived · Undo" from
        // the Inbox and "Approved: …" from a card are the same object in the same corner of the
        // window. The Inbox raises its own toasts through this.
        notify={notify}
      />
    );

  /** What the pane draws, whichever box it draws it in. One expression rather than two because the
   *  breakpoint changes the surface, not the subject — the rules in here (US-B30's person, US-D03's
   *  scoped approval queue, US-D09 §c.5's in-flow approvals) did not move with the box: S5 made the
   *  pane a drawer below 900, and this is what it draws.
   *
   *  US-B30: a person is not a thread, so it is the pane's own branch rather than a second variant
   *  of the thread route.
   *
   *  US-D03: one approval is the expanded card, the rest are one-line rows under a count. The scope
   *  is the open thread — an approval that belongs to the conversation in front of you is the one
   *  you are working on; with nothing open the whole queue is the scope. The decision still goes to
   *  the hub over HTTP (contract §5) — Zero only carries the read.
   *
   *  With nothing open the pane *is* the queue, so the stack is the whole pane. With a thread open
   *  the stack is handed to the screen instead, which draws it under the thread's own title: the
   *  pane has to open on what it is about. loop-r1-07 gives an agent session a title of its own, so
   *  it takes the same two props and does the same thing with them.
   *
   *  `visibleApprovals` and not `approvals`, here as in the auto-open rule above: a card that has
   *  just been decided has already left the pane, and the toast offering the undo is what it left
   *  behind. */
  const paneBody =
    openPersonId !== null ? (
      <PersonDetail personId={openPersonId} onOpenThread={openThreadFromPerson} />
    ) : open === null ? (
      <ApprovalStack approvals={visibleApprovals} openThreadId={null} onDecide={onDecide} />
    ) : open.agentSession ? (
      // loop-r1-07: the approvals go *into* the session screen, under its new header, rather than
      // sitting above it — a stack with no subject over a pane with no title was the shape that let
      // a "Blocked" session say nothing about what it was blocked on.
      <AgentSession
        sessionThreadId={open.threadId}
        approvals={visibleApprovals}
        onDecide={onDecide}
      />
    ) : (
      // US-D09 §c.5: the thread's approvals go *into* the conversation, in document order, so this
      // screen gets the list rather than a stack to draw above it. The stack still owns the pane
      // with nothing open, where the queue is the whole subject.
      <Thread
        threadId={open.threadId}
        approvals={visibleApprovals}
        onDecide={onDecide}
        heldItemIds={heldItemIds}
      />
    );

  return (
    <main
      data-testid="app-shell"
      className={[
        "app-shell",
        columnShape && "app-shell--with-detail",
        sheetShape && "app-shell--detail-sheet",
        closing && "app-shell--detail-closing",
        dragging && "app-shell--detail-dragging",
      ]
        .filter(Boolean)
        .join(" ")}
      // The pane's width, in one place: the column draws it and the sheet clamps it to the viewport,
      // and the drag writes it on every frame. A custom property rather than a rule per state, so
      // there is exactly one number behind both shapes.
      style={{ "--detail-width": `${detailWidth}px` } as CSSProperties}
    >
      {/* loop-r1-03/NC-18: the keyboard route past the chrome, and the first stop in the shell.
          The rail's twelve tiles, the ask bar and the filter pills are all real controls, so there
          is nothing above the list that can simply be taken out of the tab order — and the price of
          that was 27 Tabs from a cold load to the first row. A skip link is the standard answer when
          the content sits behind chrome: one Tab, one activation, and the focus is in the list with
          the whole j/k grammar live.
          `href` and no click handler: the browser already moves the focus to a focusable fragment
          target, which is the entire mechanism. It is drawn only on the Inbox, because `#inbox-list`
          is the only thing it can point at — on any other screen it would be a link to nowhere. */}
      {screen === "inbox" ? (
        <a className="skip-link" href="#inbox-list">
          Skip to inbox list
        </a>
      ) : null}
      <ChannelRail
        channels={connectedChannels}
        selected={railChannel}
        onSelect={setRailChannel}
        screen={screen}
        onScreenChange={goTo}
      />
      <div className="app-shell__main">
        {/* The wide tier keeps the ask bar at the top of the list, where it has been since US-D01. */}
        {narrow ? null : askBar}
        {/* loop-r2-05: under the ask bar, above the rows — the one place in the shell that says
            whether what is below it is live. */}
        {connectionBanner}
        {screenBody}
      </div>
      {/* §c.9: the narrow tier's bar, above the rail bar rather than stacked into it. It is
          `position: fixed` in app.css, so being the last child of the shell costs nothing in the
          grid; it lives inside <main> because that is what makes it a descendant of the container
          the shell's container queries are measured on.

          US-D09 §c.5 gave this band to the thread's floating action bar while a thread was open.
          That bar is gone with S5's port: below 900 a thread is a drawer, a modal one covers this
          whole line with its scrim, and an action bar underneath a scrim is a row of controls the
          eye can see and the finger cannot reach. The thread's bar is the drawer's chrome row now
          (Thread.tsx), so the middle piece is the ask pill in every state. */}
      {narrow ? <BottomBar onOpenFilters={() => setFiltersOpen(true)}>{askBar}</BottomBar> : null}
      {/* US-D02b/US-D09: the detail pane no longer carries `.glass-surface`. It used to, and app.css
          took the glass back off at >=1280 — but the class itself stayed in the DOM, and §c.5 puts a
          glass toolbar inside the pane, which would then be a glass surface nested in a glass
          surface (ACCENT §4.4, reviewer check 2). The <=1279.98 look — a sheet floating over the
          list — is the same recipe, and it now lives in that block in app.css where it can be read
          next to the width and the radius it belongs to. */}
      {/* US-D10: with the pane collapsed and nothing in it there is no header to put the toggle in,
          so the way back is a chevron on the canvas — the same control, in the same place a
          sidebar's toggle lives. It is drawn only when the pane is not: two chevrons for one pane is
          the duplicate §e guard 11 rejects. */}
      {paneCollapsed && !paneRendered ? (
        <DetailPaneToggle
          collapsed
          onToggle={onPaneToggle}
          className="detail-pane__toggle--floating"
        />
      ) : null}
      {/* S5: below 900 the pane is `vaul`'s drawer — the same mechanism, the same two snap points and
          the same scrim as the filters sheet and the AI panel (narrow-drawer.tsx). It is mounted
          whenever the tier is narrow rather than only while it is up, because `vaul` animates its
          own exit and a node React had already unmounted has no animation left to run.
          `className` lands on `Drawer.Content`, which *is* the pane's box in this tier — hence
          `.app-shell__detail` here rather than on the section, and hence app.css's
          `[data-vaul-drawer].app-shell__detail` block: the pane's box rewritten for a drawer (flush
          to the bottom edge, a full viewport tall, rounded at the top only). */}
      {narrow ? (
        <NarrowDrawer
          open={paneVisible}
          onOpenChange={(next) => {
            if (!next) onPaneDismiss();
          }}
          className="app-shell__detail"
          label="Details"
        >
          <section data-testid="detail-pane">
            {/* The drawer's chrome row is the grabber: its edge is the viewport's, so there is no
                column to collapse and no divider to drag — the gesture at this edge is the drawer's
                own. */}
            <DrawerGrabber />
            {/* loop-r1-02/NC-37: "the way to close it is the same as it has always been" was not
                true of this tier — a drawer with no close control is a one-way door — so the sheet
                draws the back row the other branch draws, and app.css shows it here and hides it
                above 900. The chrome row comes with it for the same reason main draws it in every
                tier's markup: it stays `display: none` below 900 (the drawer's box has no edge to
                hang a chevron on), and keeping it in both branches is what makes the `floating` ✕
                a decision the stylesheet makes rather than a second JS tier read. */}
            <div className="detail-pane__sheet-head">
              <DetailPaneBack onBack={closePane} />
            </div>
            <div className="detail-pane__chrome">
              {floating ? <DetailPaneClose onClose={closePane} /> : null}
              <DetailPaneToggle collapsed={paneCollapsed} onToggle={onPaneToggle} />
            </div>
            {paneBody}
          </section>
        </NarrowDrawer>
      ) : paneRendered ? (
        <section data-testid="detail-pane" className="app-shell__detail">
          {/* loop-r1-02/NC-37: below 900 the pane is the window and `.detail-pane__chrome` is
              `display: none` there, so this is the tier's own way back to the list. It is drawn in
              every tier's markup and shown by one container query (app.css), which is the same trick
              the chrome row already uses — the alternative, a tier read in JS, would need a third
              matchMedia hook for a row that is a single button. */}
          <div className="detail-pane__sheet-head">
            <DetailPaneBack onBack={closePane} />
          </div>
          <div className="detail-pane__chrome">
            {/* 900–1279.98 only: the floating sheet's ✕. At >=1280 the pane is a column and the
                chevron beside it is the close, so rendering both would be two controls for one
                action in the tier that has the most room for them to be confused. */}
            {floating ? <DetailPaneClose onClose={closePane} /> : null}
            <DetailPaneToggle collapsed={paneCollapsed} onToggle={onPaneToggle} />
          </div>
          {paneBody}
        </section>
      ) : null}
      {/* US-D10 §c.1: the grip on the pane's left edge, and a sibling of the pane rather than a
          child of it. Two reasons, both structural. The grip is `position: fixed` (it must not
          scroll with the pane's own scroller), and a fixed box is positioned against the nearest
          ancestor that is a containing block for it — during the sheet's 320ms entrance that
          ancestor is the pane itself, because the entrance is a transform. As a sibling it is
          positioned against the viewport in every tier and every frame. And it outlives the pane's
          shape: the column, the sheet and the collapsed overlay all draw their left edge in the same
          place, which is the whole reason one rule can serve all three.
          It is rendered with the pane in every tier and hidden by app.css below 900, where the pane
          is the full width of the window and there is nothing to resize. */}
      {paneRendered ? (
        <DetailPaneHandle
          width={detailWidth}
          shellWidth={shellWidth}
          onWidthChange={(width) => {
            setDragging(true);
            // Deliberately not `setStoredWidth`: a frame of a gesture is not a decision, and the
            // stored value is what a reload restores — writing it 60 times a second would both
            // persist the band and rewrite how wide the pane opens next time.
            setLiveWidth(width);
          }}
          onWidthCommit={onWidthCommit}
          onCancel={onWidthCancel}
          onReset={() => {
            // A double-click goes back to the width the shell ships with — which is not a number of
            // pixels but the fraction of the window the pane has when nothing is stored. Clearing the
            // setting is how that is said; writing today's 420 would freeze it at a number.
            arranged.current = true;
            setStoredWidth(null);
            remember(DETAIL_WIDTH_KEY, null);
          }}
        />
      ) : null}
      {/* The write-feedback toast is not drawn here any more: S6's host is mounted once in
          main.tsx, beside the motion config, so that a toast outlives the screen that raised it.
          This shell is only a raiser now — `notify` above. */}
    </main>
  );
}
