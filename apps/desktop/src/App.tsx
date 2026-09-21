import {
  type ApprovalCardDecision,
  ApprovalStack,
  type ApprovalStackItem,
  BottomBar,
  ChannelRail,
  CommandPalette,
  type PaletteAction,
  type RailSelection,
  type UiChannel,
  useNarrowShell,
} from "@omnis/ui";
import { ZeroProvider, useQuery } from "@rocicorp/zero/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { decideApproval } from "./api/approvals.js";
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
  // US-D08 §c.9: below 900 the ask bar leaves the top of the list and becomes the BottomBar's
  // middle piece. One element in one of two places, never both — a second render of the palette
  // would be a second cmdk list, a second action list to keep in sync, and two things answering
  // Cmd+K.
  const narrow = useNarrowShell();
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
  const detail = open !== null || approvals.length > 0;
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
      className={detail ? "app-shell app-shell--with-detail" : "app-shell"}
    >
      <ChannelRail channels={connectedChannels} selected={railChannel} onSelect={setRailChannel} />
      <div className="app-shell__main">
        {/* The wide tier keeps the ask bar at the top of the list, where it has been since US-D01. */}
        {narrow ? null : askBar}
        <Inbox
          onOpen={setOpen}
          channelFilter={railChannel}
          onChannelFilterChange={setRailChannel}
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
      {narrow ? <BottomBar>{threadOpen ? null : askBar}</BottomBar> : null}
      {/* US-D02b/US-D09: the detail pane no longer carries `.glass-surface`. It used to, and app.css
          took the glass back off at >=1280 — but the class itself stayed in the DOM, and §c.5 puts a
          glass toolbar inside the pane, which would then be a glass surface nested in a glass
          surface (ACCENT §4.4, reviewer check 2). The <=1279.98 look — a sheet floating over the
          list — is the same recipe, and it now lives in that block in app.css where it can be read
          next to the width and the radius it belongs to. */}
      {detail && (
        <section data-testid="detail-pane" className="app-shell__detail">
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
    </main>
  );
}
