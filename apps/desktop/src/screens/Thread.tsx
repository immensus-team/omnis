import {
  type ApprovalCardDecision,
  ApprovalCardView,
  type ApprovalStackItem,
  ArchiveIcon,
  AttachmentCardView,
  type AttachmentItem,
  DraftCard,
  InfoIcon,
  type KeyValueRow,
  KeyValueTable,
  ReplyComposer,
  ReplyIcon,
  RotateCcwIcon,
  SegmentedControl,
  StatusBadge,
  TagIcon,
  ThreadToolbar,
  type ThreadToolbarAction,
  ToolCallBadge,
  type ToolCallState,
  type UiItemStatus,
  toast,
  useFloatingPane,
  useNarrowShell,
} from "@omnis/ui";
import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
import { type CHANNEL_LABEL, initialsFromName, pastelFromName } from "@omnis/ui/lib/row-meta";
import { useQuery } from "@rocicorp/zero/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { discardDraft, proposeReply, setThreadArchived } from "../api/threads.js";
import { useKeymap } from "../hooks/use-keymap.js";
import { useZeroClient } from "../zero-client.js";

export interface ThreadQueryItem {
  id: string;
  status: UiItemStatus;
  body: string;
  /** items.kind (A3 §7). Missing reads as an ordinary message — only 'tool_call' renders as
   *  anything other than body copy, and every caller that leaves it out is a fixture. */
  kind?: string;
  /** items.external_id: the id the message carries in its channel. NULL for a draft (it has not
   *  gone out yet) and for anything omnis wrote itself — which is how a discarded draft is told
   *  apart from a message the channel really has (loop-r2-02). */
  external_id?: string | null;
  /** epochs ms; the conversation is ordered by it and the header block's date comes from the last
   *  one. */
  sent_at?: number;
  attachments?: AttachmentItem[];
  tool?: { name: string; state?: ToolCallState } | null;
  /** items.author (zero-schema's `related("author")` → persons). */
  author?: { display_name: string } | null;
}

/** A5 §3.2: DraftCard appears only when an Item with status='draft' exists.
 *
 *  loop-r2-02: the draft is the *fallback* subject now. When a pending approval was raised over
 *  this item — the usual case — `foldDraft` pairs the two and the screen draws one approval card
 *  instead of a draft card beside it. This stays the whole question for a draft nobody has been
 *  asked about. */
export function findDraftItem<T extends ThreadQueryItem>(items: T[]): T | undefined {
  return items.find((i) => i.status === "draft");
}

/** loop-r2-02: "one reply, one card". A draft and the approval about it were two objects on screen
 *  that had to be decided separately, and deciding the approval left the draft behind — the same
 *  sentence, twice, with two sets of buttons.
 *
 *  The pairing is by `pending_approvals.item_id`, which is the link the proposing caller writes (the
 *  seed does; `approvals.propose` accepts it). Older rows predate that column being filled, so a
 *  `send` whose body is the draft's body is taken as the same reply: the text is what the person
 *  sees, and two `send` approvals on one thread quoting the same message are not a case this screen
 *  has to tell apart. With no draft item there is nothing to fold, and the function says so. */
export function foldDraft<T extends ThreadQueryItem>(
  items: T[],
  approvals: ApprovalStackItem[],
  threadId: string,
): { draft: T | undefined; draftApproval: ApprovalStackItem | undefined } {
  const draft = findDraftItem(items);
  if (draft === undefined) return { draft: undefined, draftApproval: undefined };
  const inThread = approvals.filter((a) => a.thread_id === threadId && a.action === "send");
  const draftApproval =
    inThread.find((a) => a.item_id === draft.id) ??
    inThread.find((a) => typeof a.args?.body === "string" && a.args.body === draft.body);
  return { draft, draftApproval };
}

/** US-D03: the detail header's segments (the reference's "Price | PPSF" control turned into the
 *  three views of one thread). The conversation is what the pane opened for, so it leads. */
export const THREAD_SEGMENTS = [
  { value: "conversation", label: "Conversation" },
  { value: "summary", label: "Summary" },
  { value: "notes", label: "Notes" },
] as const;
export type ThreadSegment = (typeof THREAD_SEGMENTS)[number]["value"];

/** US-D03: the inbox's grey subline — the single line under a title carrying channel, people and
 *  last activity. `participants` is the list of people **other than** whoever the title already
 *  names: the line is the second thing you read after the title, and repeating the title there
 *  wastes it.
 *
 *  US-D09 §c.5: the **detail** header no longer carries this line — it has the sender block above
 *  the subject instead, which is where the name and the time belong. The inbox's list header
 *  (§c.3) is the caller now, so this stays a pure function with its own test. */
export function threadSubline(parts: {
  channel: string | null;
  participants: string[];
  /** Already formatted (lib/relative-time). */
  lastActivity: string | null;
}): string {
  const people =
    parts.participants.length > 3
      ? `${parts.participants.slice(0, 3).join(", ")} +${parts.participants.length - 3}`
      : parts.participants.join(", ");
  return [
    parts.channel,
    people || null,
    parts.lastActivity ? `last activity ${parts.lastActivity}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

interface ThreadRowQuery {
  id: string;
  account_id: string;
  external_id: string;
  title?: string | null;
  scope: string;
  participants?: string[] | null;
  meta?: { summary?: string } | null;
  last_item_at?: number | null;
  unread_count: number;
  created_at: number;
  archived_at?: number | null;
}

/** One position in the conversation. §c.5 puts approvals **in** the message flow rather than in a
 *  block above it, so the body is a list of these rather than a list of items with a stack beside
 *  it — the same shape the reference has, where the thing waiting on you sits between the two
 *  messages it came between. */
export type ThreadFlowNode<T> =
  | { kind: "item"; item: T }
  | { kind: "approval"; approval: ApprovalStackItem };

/** The two streams merged by time. Both arrive sorted (the query orders items by `sent_at`, and
 *  `created_at` is monotonic for approvals), but the merge does not depend on that: it sorts, and
 *  `Array.prototype.sort` has been stable since ES2019, so an item and an approval sharing a
 *  millisecond keep the order they were pushed in — the message first, then what it caused. */
export function threadFlow<T extends ThreadQueryItem>(
  items: T[],
  approvals: ApprovalStackItem[],
  threadId: string,
): ThreadFlowNode<T>[] {
  const nodes: { at: number; node: ThreadFlowNode<T> }[] = [
    ...items.map((item) => ({ at: item.sent_at ?? 0, node: { kind: "item" as const, item } })),
    ...approvals
      .filter((approval) => approval.thread_id === threadId)
      .map((approval) => ({
        at: approval.created_at,
        node: { kind: "approval" as const, approval },
      })),
  ];
  return nodes.sort((a, b) => a.at - b.at).map((entry) => entry.node);
}

/** loop-r2-02: the ids App is holding for the ignore's 5s undo. A module constant rather than a
 *  fresh `new Set()` per render, so the empty case does not invalidate the memo below. */
const NO_HELD_ITEMS: ReadonlySet<string> = new Set();

/** loop-r2-03: how long the focus waits for the card a submit raised. Past this the reply is still
 *  on its way — Zero has not replicated it — and leaving the focus on `<body>` after ⌘Enter would
 *  cost the keyboard user their place, so the subject takes it instead. */
const CARD_FOCUS_TIMEOUT_MS = 2000;

/** loop-r2-03: the Approve button of the inline card whose quoted body is `body`.
 *
 *  A DOM query rather than a ref or a piece of state, because the card is not this screen's child:
 *  the approval arrives through Zero's replica and is drawn by the flow's own map, so there is no
 *  handle to hand across renders. The body is what identifies it — the approval id comes back from
 *  the hub, but the card that matters is the one showing the sentence just typed, and matching on
 *  the text is also what makes a re-render safe to run this against. */
function approveButtonFor(body: string): HTMLButtonElement | null {
  for (const card of document.querySelectorAll(".thread-screen .approval-card")) {
    if (card.querySelector(".approval-card__body")?.textContent?.trim() !== body) continue;
    for (const button of card.querySelectorAll("button")) {
      if (button.textContent?.trim() === "Approve") return button as HTMLButtonElement;
    }
  }
  return null;
}

/** `children` is the slot directly under the segments — US-D03 put the approval stack there. With
 *  §c.5 the approvals are in the flow, so a caller with something else to say above the
 *  conversation still has the slot; the desktop shell passes nothing. */
export function Thread({
  threadId,
  approvals,
  onDecide,
  heldItemIds = NO_HELD_ITEMS,
  children,
}: {
  threadId: string;
  /** Every pending approval the shell holds. This screen narrows to its own thread — the pane is
   *  about the conversation in front of you, and another thread's approval under this title is the
   *  thing US-D03's scoping exists to prevent. */
  approvals?: ApprovalStackItem[];
  onDecide?: (
    id: string,
    decision: ApprovalCardDecision,
    decidedArgs?: Record<string, unknown>,
  ) => void;
  /** loop-r2-02: the `item_id`s of the approvals App has taken off screen and is holding for the
   *  undo window. The approval those belong to is already gone from `approvals`, so its draft would
   *  fold to "no approval" and redraw as a standalone DraftCard for the length of the window — the
   *  card the person just dismissed, coming back. Held here means drawn as neither. */
  heldItemIds?: ReadonlySet<string>;
  children?: ReactNode;
}) {
  const zero = useZeroClient();
  // §c.5's two toolbars are one element in one of two places, never both: the JS breakpoint picks
  // the call site rather than CSS hiding one of them, so the DOM never carries two toolbars and the
  // reviewer inspecting for nested glass never finds one inside the other either.
  const narrow = useNarrowShell();
  // §c.5: the pane's second shape — the floating glass sheet of 900–1279.98. Only the bar's home and
  // material depend on it; the two are decided together below so the DOM never carries two bars.
  const floatingPane = useFloatingPane();
  const [segment, setSegment] = useState<ThreadSegment>("conversation");
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  /** loop-r2-03: the open composer, or null when there is none. An object rather than a boolean so
   *  the shape already carries the field `initialBody` will need — "Edit & send" on a draft opens
   *  the same box with text in it, and that is a prop, not a second state. */
  const [composing, setComposing] = useState<{ body: string } | null>(null);
  /** The body a submit handed to the hub, held until the card that carries it renders. */
  const [awaitingBody, setAwaitingBody] = useState<string | null>(null);
  /** The subject line, which is where the focus goes when that card is late. */
  const subject = useRef<HTMLHeadingElement>(null);

  // The read shape is the one already proven on this screen: items by thread, ascending — plus the
  // thread row itself (US-D01 read archived_at from the same query; US-D03 reads the participants,
  // the channel and the last activity from it), the connected accounts for the channel label, the
  // persons rows that turn participants (uuid[]) into names, and the notes routed to this thread.
  const [items] = useQuery(
    zero.query.items.where("thread_id", "=", threadId).orderBy("sent_at", "asc").related("author"),
  );
  const typedItems = items as unknown as ThreadQueryItem[];
  const [threads] = useQuery(zero.query.threads.where("id", "=", threadId));
  const thread = (threads as unknown as ThreadRowQuery[])[0];
  const archived = thread?.archived_at ?? null;
  const [accounts] = useQuery(zero.query.accounts);
  const [persons] = useQuery(zero.query.persons.limit(500));
  const [notes] = useQuery(zero.query.notes.where("routed_to_thread_id", "=", threadId));
  const [labels] = useQuery(zero.query.labels);
  const [threadLabels] = useQuery(zero.query.thread_labels.where("thread_id", "=", threadId));

  const personById = useMemo(() => new Map(persons.map((p) => [p.id, p.display_name])), [persons]);
  const participantNames = (thread?.participants ?? [])
    .map((id) => personById.get(id))
    .filter((name): name is string => Boolean(name));
  const channel =
    (accounts.find((a) => a.id === thread?.account_id)?.channel as keyof typeof CHANNEL_LABEL) ??
    null;
  // The title follows the inbox row's chain (thread title -> participant -> channel handle), so the
  // pane and the row it opened from name the same conversation the same way.
  const title = thread?.title || participantNames[0] || thread?.external_id || "Thread";

  // §c.5's header block is the *last* message's header, the way Mail shows a thread: who wrote the
  // thing you are looking at and when. Falling back to the thread row keeps a thread with no items
  // (a freshly ingested one) from drawing an empty block.
  const lastItem = typedItems[typedItems.length - 1];
  const senderName = lastItem?.author?.display_name ?? participantNames[0] ?? title;
  const senderAt = lastItem?.sent_at ?? thread?.last_item_at ?? null;
  const senderTime = senderAt === null ? null : formatRelativeTime(senderAt);

  // loop-r2-02: the draft and its approval leave the flow and are drawn once, under it. The draft
  // item goes either way — as its card, or as nothing while App holds the ignored approval — so it
  // is removed here rather than at the render site, or it would reappear as a message bubble in the
  // frame the card left.
  const { draft, draftApproval } = useMemo(
    () => foldDraft(typedItems, approvals ?? [], threadId),
    [typedItems, approvals, threadId],
  );
  const draftHeld = draft !== undefined && heldItemIds.has(draft.id);
  const flow = useMemo(() => {
    const flowItems = typedItems.filter(
      (item) =>
        item.id !== draft?.id &&
        // A discarded draft that never reached the channel: `archived` with no `external_id`. The
        // items query carries no status filter (below), so without this the text the person just
        // threw away comes straight back into the conversation.
        !(item.status === "archived" && !item.external_id),
    );
    const flowApprovals = (approvals ?? []).filter((a) => a.id !== draftApproval?.id);
    return threadFlow(flowItems, flowApprovals, threadId);
  }, [typedItems, approvals, threadId, draft, draftApproval]);

  // The thread's own facts, in the one component allowed to draw hairlines.
  // The Label action's panel: the thread's labels through thread_labels (items have no labels
  // relation — A5 §3.1 attaches them to threads).
  const labelNames = useMemo(() => {
    const nameById = new Map(labels.map((l) => [l.id, l.name]));
    return threadLabels
      .map((tl) => nameById.get(tl.label_id))
      .filter((name): name is string => Boolean(name));
  }, [labels, threadLabels]);

  const metaRows: KeyValueRow[] = thread
    ? [
        { label: "Thread id", value: thread.external_id },
        { label: "Scope", value: thread.scope },
        { label: "Unread", value: thread.unread_count, numeric: true },
        { label: "Created", value: formatRelativeTime(thread.created_at), numeric: true },
        ...(thread.last_item_at
          ? [
              {
                label: "Last activity",
                value: formatRelativeTime(thread.last_item_at),
                numeric: true,
              },
            ]
          : []),
      ]
    : [];

  // §c.5: archive is the one real state change on this screen. loop-r2-03 wired the other control:
  // Reply opens the composer below, and `r` is its keyboard twin. The two share `openComposer`
  // rather than each holding its own copy of "open the box" — §e guard 10 wants every affordance to
  // have a non-gesture twin, and a twin that drifts is worse than none.
  const archiveAction: ThreadToolbarAction = {
    id: "archive",
    label: archived !== null ? "Restore thread" : "Archive thread",
    icon: archived !== null ? RotateCcwIcon : ArchiveIcon,
    onSelect: () => void setThreadArchived(threadId, archived === null),
  };
  const openComposer = useCallback(() => {
    // The composer is drawn under the conversation, so a person who opens it from the Summary or
    // Notes segment is moved to the view that can show it. Opening a box on a segment that does not
    // render it would be a keyboard shortcut that appears to do nothing.
    setSegment("conversation");
    setComposing({ body: "" });
  }, []);
  const replyAction: ThreadToolbarAction = {
    id: "reply",
    label: "Reply",
    icon: ReplyIcon,
    onSelect: openComposer,
  };

  // loop-r2-03: `r` is the composer's keyboard twin. use-keymap already resolves the letter to
  // "reply"; this is the only screen that can answer it, and Inbox.tsx's own registration handles
  // the disjoint set of row actions, which is the same division App.tsx's go-to keys use. An
  // archived thread is left out: replying to something already filed away is a write the person did
  // not ask for, and the toolbar's Reply stays live there only because the banner's Restore is one
  // click away. Typing is excluded by isEditableTarget, so `r` inside the box is a letter.
  useKeymap(
    useCallback(
      (action: string) => {
        if (action !== "reply" || archived !== null) return;
        openComposer();
      },
      [archived, openComposer],
    ),
  );

  // The composer opens at the end of a conversation that can be long, and the toolbar that opened it
  // may be off screen by then. `block: "nearest"` and not `"end"`: if the box already fits in what
  // the person is looking at, nothing moves.
  useEffect(() => {
    if (composing === null) return;
    document.querySelector(".reply-composer")?.scrollIntoView({ block: "nearest" });
  }, [composing]);

  // The focus a submit is owed. Two effects rather than one because they are two different waits:
  // this one gives up after CARD_FOCUS_TIMEOUT_MS, and the one below hands the focus over the moment
  // the card renders. Whichever happens first cancels the other, because both end with
  // `awaitingBody` cleared.
  useEffect(() => {
    if (awaitingBody === null) return;
    const timer = setTimeout(() => {
      setAwaitingBody(null);
      subject.current?.focus();
    }, CARD_FOCUS_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [awaitingBody]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `approvals` is the trigger, not a read — the card is rendered from that list, so a new list is the only signal that its button may now be on screen. The lookup itself runs against the DOM the list produced, which no dependency can name.
  useEffect(() => {
    if (awaitingBody === null) return;
    const approve = approveButtonFor(awaitingBody);
    if (approve === null) return;
    setAwaitingBody(null);
    approve.focus();
  }, [awaitingBody, approvals]);

  // §c.7's menu, shared by both tiers' bars. The two header disclosures moved into it: an icon whose
  // job is to open a panel is a menu row, and the pane's overflow is where they belong now that the
  // header carries no controls of its own.
  const toolbarMenu = {
    label: "Thread options",
    groups: [
      {
        items: [
          {
            id: "labels",
            label: "Labels",
            icon: TagIcon,
            onSelect: () => setLabelsOpen((v) => !v),
          },
          {
            id: "details",
            label: "Details",
            icon: InfoIcon,
            onSelect: () => setMetaOpen((v) => !v),
          },
        ],
      },
    ],
  };

  // One bar, two homes and never two at once. `narrow` joins the sheet tier because below 900 the
  // pane *is* a sheet — S5 made it the same `vaul` drawer the filters come up in — so the bar is
  // that drawer's chrome row, exactly where it stands from 900 to 1279.98.
  //
  // There used to be a third home: a floating action bar portaled into the BottomBar's line between
  // the filters circle and the compose circle, with an archive · move · reply set. A modal drawer
  // owns the pointer for everything outside itself — Radix sets `pointer-events: none` on the body —
  // so a bar sitting in a line under the drawer's scrim would be visible and untouchable, which is
  // worse than the disabled "Move to folder" its set carried. The three-action set is gone with it;
  // archive and reply are the two the pane's bar has always had at every other width.
  const toolbarHome = narrow || floatingPane ? "chrome" : "flow";

  // The pane's bar: reply · archive · more. It is one element with one material per tier, because
  // the surface it stands on changes. Wide (>=1280) the pane is an opaque grid column, so the bar
  // is the glass capsule §c.5 specs. From 900 to 1279.98 the pane is itself a floating glass sheet
  // (`@container shell (max-width: 1279.98px)`), and a glass capsule inside a glass sheet is the
  // nesting ACCENT §4.4 rejects — there the bar drops its material and becomes the sheet's chrome
  // row, which is also why it is rendered outside `.thread-screen` in that tier: a scroller's
  // content would otherwise slide under a bar that no longer has a field to hide it.
  const paneToolbar = (
    <ThreadToolbar
      className="thread-toolbar--pane"
      variant={toolbarHome === "chrome" ? "chrome" : "glass"}
      actions={[replyAction, archiveAction]}
      menu={toolbarMenu}
    />
  );

  return (
    <>
      {/* The sheet's chrome row: a child of the pane, a sibling of the scroller. It carries no
          material because the sheet behind it is the material. */}
      {toolbarHome === "chrome" && paneToolbar}
      <div className="thread-screen">
        {toolbarHome === "flow" && paneToolbar}
        {archived !== null && (
          <div className="thread-screen__archived-banner">
            <span>Archived</span>
            <button type="button" onClick={() => void setThreadArchived(threadId, false)}>
              Restore
            </button>
          </div>
        )}
        <header className="thread-header">
          {/* §c.5's sender block: 40px avatar, name, "To: me", and the date right-aligned to the
            first line, closed by one hairline. It replaced the old title-plus-subline header —
            the title moved down to the subject below it, where a 24px line belongs. */}
          <div className="thread-header__sender">
            <span
              className="thread-header__avatar"
              style={{ background: pastelFromName(senderName) }}
              aria-hidden="true"
            >
              {initialsFromName(senderName)}
            </span>
            <span className="thread-header__who">
              <span className="thread-header__name">{senderName}</span>
              <span className="thread-header__to">To: me</span>
            </span>
            {senderTime !== null && (
              <time
                className="thread-header__date"
                dateTime={new Date(senderAt ?? 0).toISOString()}
              >
                {senderTime}
              </time>
            )}
          </div>
          {/* loop-r2-03: the subject is the screen's focus fallback — when a submitted reply's card
              has not rendered within CARD_FOCUS_TIMEOUT_MS the focus lands here rather than on
              `<body>`. `tabIndex={-1}` is what makes an `<h2>` a focus target; it does not put the
              subject in the tab order, so nothing about Tab changes. */}
          <h2 className="thread-header__subject" ref={subject} tabIndex={-1}>
            {title}
          </h2>
        </header>
        <div className="thread-header__segments">
          <SegmentedControl
            options={THREAD_SEGMENTS}
            value={segment}
            onChange={setSegment}
            label="Thread view"
          />
        </div>
        {(labelsOpen || metaOpen) && (
          <div className="thread-header__labels">
            {labelsOpen && (
              <KeyValueTable rows={[{ label: "Labels", value: labelNames.join(", ") || "None" }]} />
            )}
            {metaOpen && <KeyValueTable rows={metaRows} />}
          </div>
        )}
        {children}
        {segment === "summary" && (
          <p className="thread-panel">
            {thread?.meta?.summary ?? "No summary for this thread yet."}
          </p>
        )}
        {segment === "notes" && (
          <div className="thread-panel">
            {notes.length === 0 ? (
              <p className="thread-panel__empty">No notes on this thread yet.</p>
            ) : (
              notes.map((note) => (
                <div key={note.id} className="thread-panel__note">
                  <span className="thread-panel__note-time">
                    {formatRelativeTime(note.created_at)}
                  </span>
                  {note.body}
                </div>
              ))
            )}
          </div>
        )}
        {segment === "conversation" && (
          <>
            {flow.map((node) =>
              node.kind === "approval" ? (
                // §c.5: inline, in document order, opaque. The card keeps its own component; only its
                // container changed — it used to be a stack above the conversation.
                <ApprovalCardView
                  key={`approval-${node.approval.id}`}
                  interrupt={node.approval}
                  className="thread-screen__approval"
                  // loop-r2-01: the card says where the action goes, and in a thread the answer is
                  // the thread's own title — the same string this screen prints in its header.
                  destination={title}
                  onDecide={(decision, decidedArgs) =>
                    onDecide?.(node.approval.id, decision, decidedArgs)
                  }
                />
              ) : (
                <ThreadItem key={node.item.id} item={node.item} />
              ),
            )}
            {/* loop-r2-02: the draft and its approval are one object. The folded card is the
                ApprovalCardView of 01 — same buttons, same editor, same confirm — so Approve sends,
                Edit edits then sends, and Discard is an ignore, all through the one `onDecide` path
                every other card uses. `provenance` is what says the message was drafted rather than
                written by the person, which is the one thing the standalone card said that this one
                would otherwise lose. */}
            {draftHeld ? null : draftApproval !== undefined ? (
              <ApprovalCardView
                key={`draft-approval-${draftApproval.id}`}
                interrupt={draftApproval}
                className="thread-screen__draft"
                destination={title}
                provenance="Drafted from memory and past threads"
                ignoreLabel="Discard"
                onDecide={(decision, decidedArgs) =>
                  onDecide?.(draftApproval.id, decision, decidedArgs)
                }
              />
            ) : draft !== undefined ? (
              /* The fallback: a draft nobody has been asked about. Discard is the only thing this
                 screen can offer it — "Edit & send" goes back on it with the composer (loop-r2-03),
                 and a second button that does nothing is what the testers reported. The write goes
                 through the hub (Zero grants no write permissions); a failure says so instead of
                 disappearing. */
              <DraftCard
                body={draft.body}
                rationale="memory, past threads"
                onDiscard={() => {
                  void discardDraft(draft.id).catch(() => {
                    toast.error("Couldn't discard the draft.");
                  });
                }}
              />
            ) : null}
            {/* loop-r2-03: the composer is the last thing in the conversation — where a reply is
                written in every mail client, and after the folded card so the box the person is
                typing into is not above the reply they were just asked about (the reference's
                reply block sits at the end of the thread, on the opaque body).
                It proposes rather than sends: the `send` approval it raises arrives through Zero as
                an ordinary inline card in the flow above this box, which is what the focus hand-off
                above is waiting for. */}
            {composing !== null && (
              <ReplyComposer
                destination={title}
                channel={channel}
                initialBody={composing.body}
                onSubmit={async (body) => {
                  await proposeReply(threadId, body);
                  // The focus is owed to the card this raised, so the body is kept until it renders.
                  setAwaitingBody(body);
                  setComposing(null);
                }}
                onCancel={() => setComposing(null)}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

/** One message in the flow. A tool call is the one kind that is not prose — it renders as the
 *  badge AgentSession already uses, so the same event reads the same way in both screens. */
function ThreadItem({ item }: { item: ThreadQueryItem }) {
  if (item.kind === "tool_call" && item.tool) {
    return (
      <ToolCallBadge
        tool={item.tool.name}
        state={item.tool.state ?? "loading"}
        {...(item.body ? { resultSummary: item.body } : {})}
      />
    );
  }
  return (
    <div className="thread-screen__item">
      <StatusBadge status={item.status} />
      <p>{item.body}</p>
      {item.attachments?.map((attachment, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: protocol's Attachment carries no id and one message can hold the same file twice, so position is the only thing that distinguishes two identical cards.
        <AttachmentCardView key={index} attachment={attachment} />
      ))}
    </div>
  );
}
