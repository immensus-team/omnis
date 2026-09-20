import {
  type ApprovalCardDecision,
  ApprovalStack,
  type ApprovalStackItem,
  ChannelRail,
  CommandPalette,
  type PaletteAction,
  type RailSelection,
  type UiChannel,
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

  return (
    <main
      data-testid="app-shell"
      className={detail ? "app-shell app-shell--with-detail" : "app-shell"}
    >
      <ChannelRail channels={connectedChannels} selected={railChannel} onSelect={setRailChannel} />
      <div className="app-shell__main">
        <CommandPalette
          mode="inline"
          open={askOpen}
          onOpenChange={setAskOpen}
          actions={actions}
          threadSelected={open !== null}
          threadSummary={selectedThreadSummary}
          threadTitle={selectedThreadTitle}
        />
        <Inbox
          onOpen={setOpen}
          channelFilter={railChannel}
          onChannelFilterChange={setRailChannel}
        />
      </div>
      {/* US-D02b: the detail pane always renders with the sheet's glass, whatever the width. In
          the narrow shells (<=1279.98px) that is what it actually is — a glass sheet floating over
          the list — and in the wide shell app.css's `@container shell (min-width: 1280px)` takes
          the glass back off, returning it to today's opaque column. With no JS branch on width,
          there is only one place to change. */}
      {detail && (
        <section
          data-testid="detail-pane"
          className="app-shell__detail glass-surface"
          data-glass-slot="sheet"
        >
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
            <Thread threadId={open.threadId}>
              <ApprovalStack
                approvals={approvals as unknown as ApprovalStackItem[]}
                openThreadId={open.threadId}
                onDecide={onDecide}
              />
            </Thread>
          )}
        </section>
      )}
    </main>
  );
}
