import {
  ArchiveIcon,
  DraftCard,
  type KeyValueRow,
  KeyValueTable,
  MoreHorizontalIcon,
  SegmentedControl,
  StatusBadge,
  TagIcon,
  type UiItemStatus,
} from "@omnis/ui";
import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
import { CHANNEL_LABEL } from "@omnis/ui/lib/row-meta";
import { useQuery } from "@rocicorp/zero/react";
import { useMemo, useState } from "react";
import { setThreadArchived } from "../api/threads.js";
import { useZeroClient } from "../zero-client.js";

export interface ThreadQueryItem {
  id: string;
  status: UiItemStatus;
  body: string;
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

/** US-D03: the header's subline — the single grey line under the title in
 *  ref-dashboard-detail-card.webp, carrying channel, people and last activity.
 *  `participants` is the list of people **other than** whoever the title already names: the line
 *  is the second thing you read after the title, and repeating the title there wastes it. */
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

export function Thread({ threadId }: { threadId: string }) {
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
  const subline = threadSubline({
    channel: channel ? CHANNEL_LABEL[channel] : null,
    participants: thread?.title ? participantNames : participantNames.slice(1),
    lastActivity: thread?.last_item_at ? formatRelativeTime(thread.last_item_at) : null,
  });

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
        <div className="thread-header__main">
          <h2 className="thread-header__title">{title}</h2>
          {subline && <p className="thread-header__subline">{subline}</p>}
        </div>
        {/* The three icon actions from the reference's card header. Archive is a real state change;
            Label and More are disclosures rather than icon-shaped decoration — an icon that does
            nothing when pressed is worse than no icon. */}
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
          {typedItems.map((item) => (
            <div key={item.id} className="thread-screen__item">
              <StatusBadge status={item.status} />
              <p>{item.body}</p>
            </div>
          ))}
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
