import {
  type ApprovalCardDecision,
  ApprovalCardView,
  type ApprovalStackItem,
  ArchiveIcon,
  AttachmentCardView,
  type AttachmentItem,
  DraftCard,
  type KeyValueRow,
  KeyValueTable,
  MoreHorizontalIcon,
  SegmentedControl,
  StatusBadge,
  TagIcon,
  ToolCallBadge,
  type ToolCallState,
  type UiItemStatus,
} from "@omnis/ui";
import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
import { type CHANNEL_LABEL, initialsFromName, pastelFromName } from "@omnis/ui/lib/row-meta";
import { useQuery } from "@rocicorp/zero/react";
import { type ReactNode, useMemo, useState } from "react";
import { setThreadArchived } from "../api/threads.js";
import { useZeroClient } from "../zero-client.js";

export interface ThreadQueryItem {
  id: string;
  status: UiItemStatus;
  body: string;
  /** items.kind (A3 §7). Missing reads as an ordinary message — only 'tool_call' renders as
   *  anything other than body copy, and every caller that leaves it out is a fixture. */
  kind?: string;
  /** epochs ms; the conversation is ordered by it and the header block's date comes from the last
   *  one. */
  sent_at?: number;
  attachments?: AttachmentItem[];
  tool?: { name: string; state?: ToolCallState } | null;
  /** items.author (zero-schema's `related("author")` → persons). */
  author?: { display_name: string } | null;
}

/** A5 §3.2: DraftCard appears only when an Item with status='draft' exists. */
export function findDraftItem<T extends ThreadQueryItem>(items: T[]): T | undefined {
  return items.find((i) => i.status === "draft");
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

/** `children` is the slot directly under the segments — US-D03 put the approval stack there. With
 *  §c.5 the approvals are in the flow, so a caller with something else to say above the
 *  conversation still has the slot; the desktop shell passes nothing. */
export function Thread({
  threadId,
  approvals,
  onDecide,
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
  children?: ReactNode;
}) {
  const zero = useZeroClient();
  const [segment, setSegment] = useState<ThreadSegment>("conversation");
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);

  // The read shape is the one already proven on this screen: items by thread, ascending — plus the
  // thread row itself (US-D01 read archived_at from the same query; US-D03 reads the participants,
  // the channel and the last activity from it), the connected accounts for the channel label, the
  // persons rows that turn participants (uuid[]) into names, and the notes routed to this thread.
  const [items] = useQuery(
    zero.query.items.where("thread_id", "=", threadId).orderBy("sent_at", "asc").related("author"),
  );
  const typedItems = items as unknown as ThreadQueryItem[];
  const draft = findDraftItem(typedItems);
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

  const flow = useMemo(
    () => threadFlow(typedItems, approvals ?? [], threadId),
    [typedItems, approvals, threadId],
  );

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

  return (
    <div className="thread-screen">
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
            <time className="thread-header__date" dateTime={new Date(senderAt ?? 0).toISOString()}>
              {senderTime}
            </time>
          )}
        </div>
        <h2 className="thread-header__subject">{title}</h2>
        {/* The three icon actions from the reference's card header. Archive is a real state change;
            Label and More are disclosures rather than icon-shaped decoration — an icon that does
            nothing when pressed is worse than no icon. §c.5 moves them into the pane's toolbar. */}
        <div className="thread-header__actions">
          <button
            type="button"
            className="thread-header__action"
            aria-label={archived !== null ? "Restore thread" : "Archive thread"}
            title={archived !== null ? "Restore" : "Archive"}
            onClick={() => void setThreadArchived(threadId, archived === null)}
          >
            <ArchiveIcon size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="thread-header__action"
            aria-label="Labels"
            title="Labels"
            aria-pressed={labelsOpen}
            onClick={() => setLabelsOpen((v) => !v)}
          >
            <TagIcon size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="thread-header__action"
            aria-label="More details"
            title="More details"
            aria-pressed={metaOpen}
            onClick={() => setMetaOpen((v) => !v)}
          >
            <MoreHorizontalIcon size={16} aria-hidden="true" />
          </button>
        </div>
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
        <p className="thread-panel">{thread?.meta?.summary ?? "No summary for this thread yet."}</p>
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
                onDecide={(decision, decidedArgs) =>
                  onDecide?.(node.approval.id, decision, decidedArgs)
                }
              />
            ) : (
              <ThreadItem key={node.item.id} item={node.item} />
            ),
          )}
          {draft && (
            <DraftCard
              body={draft.body}
              rationale="memory, past threads"
              onEditAndSend={() => {
                /* Composer wiring is out of this story's scope (YAGNI) */
              }}
              onDiscard={() => zero.mutate.items.update({ id: draft.id, status: "archived" })}
              onRegenerate={() => {
                /* Re-requesting propose_draft belongs to packages/agents; this screen only exposes
                   the trigger. */
              }}
            />
          )}
        </>
      )}
    </div>
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
