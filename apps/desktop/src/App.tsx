import {
  type ApprovalCardDecision,
  ApprovalStack,
  type ApprovalStackItem,
  ChannelRail,
  CommandPalette,
  type CommandPaletteSearch,
  type PaletteAction,
  type RailSelection,
  type UiChannel,
  type UiSearchGroup,
  type UiSearchHit,
} from "@omnis/ui";
import { ZeroProvider, useQuery } from "@rocicorp/zero/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decideApproval } from "./api/approvals.js";
import { type SearchHit, search, toUiSearchGroups } from "./api/search.js";
import { AgentSession } from "./screens/AgentSession.js";
import { Inbox, type OpenTarget } from "./screens/Inbox.js";
import { Network, PersonDetail } from "./screens/Network.js";
import { Tasks } from "./screens/Tasks.js";
import { Thread } from "./screens/Thread.js";
import { Today } from "./screens/Today.js";
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

/** The screens the shell can show. The rail switches between them by screen, not by route —
 *  there is no URL router in the desktop app (src-tauri loads one documents). */
export type ShellScreen = "inbox" | "today" | "tasks" | "network";

export function App({ screen = "inbox" }: { screen?: ShellScreen }) {
  // Without ZeroProvider, useQuery dies with "useZero must be used within a ZeroProvider".
  return (
    <ZeroProvider zero={getZero()}>
      <Shell screen={screen} />
    </ZeroProvider>
  );
}

function Shell({ screen }: { screen: ShellScreen }) {
  const zero = useZeroClient();
  const [open, setOpen] = useState<OpenTarget | null>(null);
  // US-B30: a person is not a thread, so the detail pane's target is its own state rather than a
  // second variant on OpenTarget — the pane draws PersonDetail or Thread, never a mix, and one
  // nullable string says that more plainly than a discriminated union with two members.
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
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
  const onDecide = useCallback(
    (id: string, decision: ApprovalCardDecision, decidedArgs?: Record<string, unknown>) => {
      void decideApproval(id, decision, decidedArgs);
    },
    [],
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

  // Deep links the shell can keep: only the thread route exists so far (a person link's Network
  // screen and a digest link's Digest screen are other Phase B stories), and a memory's deep link
  // carries an item id but no thread id — so a memory row is shown and not followed yet.
  const openHit = useCallback((hit: UiSearchHit) => {
    const link = hits.current.get(`${hit.kind}:${hit.id}`)?.deep_link;
    if (link?.screen !== "thread" || link.thread_id === undefined) return;
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
  // no navigation (A5 §3.4) — so the shell leaves the pane closed for it until a thread is actually
  // opened. Opening it on the queue's account would draw the same approvals twice on one screen,
  // and at 390 the sheet would cover the screen it duplicates.
  const detail =
    open !== null || openPersonId !== null || (screen === "inbox" && approvals.length > 0);

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
          search={paletteSearch}
          threadSelected={open !== null}
          threadSummary={selectedThreadSummary}
          threadTitle={selectedThreadTitle}
        />
        {screen === "today" ? (
          <Today onOpenThread={openThread} />
        ) : screen === "network" ? (
          <Network onOpenPerson={setOpenPersonId} onOpenThread={openThreadFromPerson} />
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
          />
        )}
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
          {openPersonId !== null ? (
            <PersonDetail personId={openPersonId} onOpenThread={openThreadFromPerson} />
          ) : open === null ? (
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
