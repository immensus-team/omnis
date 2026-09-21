import {
  type ApprovalCardDecision,
  ApprovalStack,
  type ApprovalStackItem,
  BottomBar,
  ChannelRail,
  CommandPalette,
  DETAIL_COLLAPSED_KEY,
  DETAIL_DEFAULT_WIDTH,
  DETAIL_WIDTH_KEY,
  DetailPaneHandle,
  DetailPaneToggle,
  LEAVE_MS,
  type PaletteAction,
  type RailSelection,
  type UiChannel,
  clampDetailWidth,
  readDetailCollapsed,
  readDetailWidth,
  useClosingSpring,
  useFloatingPane,
  useNarrowShell,
} from "@omnis/ui";
import { ZeroProvider, useQuery } from "@rocicorp/zero/react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decideApproval } from "./api/approvals.js";
import { fetchSettings, putSetting } from "./api/settings.js";
import { AgentSession } from "./screens/AgentSession.js";
import { Inbox, type OpenTarget } from "./screens/Inbox.js";
import { Thread } from "./screens/Thread.js";
import { initZero, useZeroClient } from "./zero-client.js";

// Created at module scope it would open a WebSocket on import alone — deferred to first render.
let zeroClient: ReturnType<typeof initZero> | undefined;
function getZero() {
  zeroClient ??= initZero();
  return zeroClient;
}

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

export function App() {
  // Without ZeroProvider, useQuery dies with "useZero must be used within a ZeroProvider".
  return (
    <ZeroProvider zero={getZero()}>
      <Shell />
    </ZeroProvider>
  );
}

function Shell() {
  const zero = useZeroClient();
  const [open, setOpen] = useState<OpenTarget | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [railChannel, setRailChannel] = useState<RailSelection>(null);
  // US-D09 §c.6: the BottomBar's filters circle opens M125's sheet, and the sheet edits the list's
  // own filter state — so the open flag lives here (the trigger is in this file's bar) while the
  // rows live in Inbox.tsx (which owns what they change).
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  useCommandPaletteKey(() => setAskOpen((v) => !v));

  // Approvals are read through Zero (the read-only path) and only the decision goes to the hub
  // over HTTP — contract §5.
  const [approvals] = useQuery(zero.query.pending_approvals.where("state", "=", "pending"));
  const [accounts] = useQuery(zero.query.accounts);

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
  const onDecide = useCallback(
    (id: string, decision: ApprovalCardDecision, decidedArgs?: Record<string, unknown>) => {
      void decideApproval(id, decision, decidedArgs);
    },
    [],
  );

  const actions: PaletteAction[] = [
    {
      id: "go-inbox",
      name: "Go to Inbox",
      shortcut: "g i",
      group: "Navigate",
      perform: () => {
        setOpen(null);
        setRailChannel(null);
      },
    },
  ];

  // The kinso reference has only a rail and a main column — the detail pane opens a third column
  // only when there is something to look at. (Keeping an empty pane open shrinks the Inbox card
  // into a sidebar taking a third of the window.)
  //
  // US-D10 narrows that: below 900 the pane is a full-width sheet and there is no toggle to press,
  // so the user's collapse flag does not apply there — the tier keeps the behaviour it had.
  const paneCollapsed = collapsed && !narrow;
  // Collapsed, only a thread the user asked for opens the pane. The approval queue is *why* the pane
  // auto-opens; a pane the user has collapsed must not re-open itself for it.
  const paneVisible = open !== null || (!paneCollapsed && approvals.length > 0);
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
  // §c.5: a thread — not the approval queue, and not an agent session, which draws no toolbar —
  // owns the narrow tier's action-band when one is open. It is the same condition Thread.tsx uses
  // to decide whether to portal its floating bar, and it has to be, or the band would hold both the
  // pill and the bar.
  const threadOpen = open !== null && !open.agentSession;

  const askBar = (
    <CommandPalette
      mode="inline"
      open={askOpen}
      onOpenChange={setAskOpen}
      actions={actions}
      threadSelected={open !== null}
      threadSummary={selectedThreadSummary}
      threadTitle={selectedThreadTitle}
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
      <ChannelRail channels={connectedChannels} selected={railChannel} onSelect={setRailChannel} />
      <div className="app-shell__main">
        {/* The wide tier keeps the ask bar at the top of the list, where it has been since US-D01. */}
        {narrow ? null : askBar}
        <Inbox
          onOpen={setOpen}
          channelFilter={railChannel}
          onChannelFilterChange={setRailChannel}
          filtersOpen={filtersOpen}
          onFiltersOpenChange={setFiltersOpen}
        />
      </div>
      {/* §c.9: the narrow tier's bar, above the rail bar rather than stacked into it. It is
          `position: fixed` in app.css, so being the last child of the shell costs nothing in the
          grid; it lives inside <main> because that is what makes it a descendant of the container
          the shell's container queries are measured on.

          US-D09 §c.5: with a thread open in this tier the middle piece is not the ask pill — that
          band belongs to the thread's floating action bar, which Thread.tsx portals to the body so
          it can sit in the BottomBar's line between the two circles. Rendering the pill as well
          would put two controls in one slot (§e guard 11 wants a twin, not a duplicate). */}
      {narrow ? (
        <BottomBar onOpenFilters={() => setFiltersOpen(true)}>
          {threadOpen ? null : askBar}
        </BottomBar>
      ) : null}
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
      {paneRendered && (
        <section data-testid="detail-pane" className="app-shell__detail">
          <div className="detail-pane__chrome">
            <DetailPaneToggle collapsed={paneCollapsed} onToggle={onPaneToggle} />
          </div>
          {/* US-D03: one approval is the expanded card, the rest are one-line rows under a count.
              The scope is the open thread — an approval that belongs to the conversation in front
              of you is the one you are working on; with nothing open the whole queue is the scope.
              The decision still goes to the hub over HTTP (contract §5) — Zero only carries the
              read.

              With nothing open the pane *is* the queue, so the stack is the whole pane. With a
              thread open the stack is handed to the screen instead, which draws it under the
              thread's own title: the pane has to open on what it is about. (An agent session has
              no header of its own, so there it stays on top.) */}
          {open === null ? (
            <ApprovalStack
              approvals={approvals as unknown as ApprovalStackItem[]}
              openThreadId={null}
              onDecide={onDecide}
            />
          ) : open.agentSession ? (
            <>
              <ApprovalStack
                approvals={approvals as unknown as ApprovalStackItem[]}
                openThreadId={open.threadId}
                onDecide={onDecide}
              />
              <AgentSession sessionThreadId={open.threadId} />
            </>
          ) : (
            // US-D09 §c.5: the thread's approvals go *into* the conversation, in document order,
            // so this screen gets the list rather than a stack to draw above it. The stack still
            // owns the pane with nothing open, where the queue is the whole subject.
            <Thread
              threadId={open.threadId}
              approvals={approvals as unknown as ApprovalStackItem[]}
              onDecide={onDecide}
            />
          )}
        </section>
      )}
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
    </main>
  );
}
