import { OpaqueSurface, type UiChannel } from "@omnis/ui";
import { InboxRow, type RowAvatar } from "@omnis/ui/components/inbox-row";
import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
import {
  type AgentRuntimeKind,
  type AgentSessionKinsoState,
  agentSessionKinsoState,
} from "@omnis/ui/lib/row-meta";
import { useQuery } from "@rocicorp/zero/react";
import { useMemo } from "react";
import { useZeroClient } from "../zero-client.js";

/** The tab's landing screen: the same row grammar as the desktop Inbox (A5 §3.1) over the same
 *  replicated tables, narrowed to what a phone can act on.
 *
 *  This is NOT apps/desktop's Inbox re-exported — an app may depend on @omnis/ui and never on
 *  another app (apps/gallery/src/vendor/app-styles.css documents the rule for CSS; it holds for
 *  components too, and apps/desktop's screens are not a package). The plan's own open question is
 *  whether the five desktop screens should move somewhere both apps can import; until that is
 *  decided, this is the small version of the one screen the shell opens on, built from the same
 *  @omnis/ui components and the same query shape (items with thread+author, de-duplicated per
 *  thread) so the two do not drift in what a row *means*. The desktop's filters, label chips,
 *  archive view and leave animation are deliberately absent. */

/** One row of the query, as the mapper sees it. Optional and nullable throughout because this is
 *  also what the tests hand it: `thread`/`author` are ZQL relations and are simply absent on a row
 *  that has none. */
export interface InboxRowSource {
  thread_id: string;
  account_id: string;
  status?: string | undefined;
  sent_at: number;
  body: string;
  subject?: string | null | undefined;
  author?: { display_name?: string | null | undefined } | null | undefined;
  thread?:
    | {
        title?: string | null | undefined;
        unread_count?: number | undefined;
        kind?: string | undefined;
        meta?: unknown;
      }
    | null
    | undefined;
}

/** An agent session for a thread, joined in by the caller (agent_sessions + agent_runtimes). */
export interface SessionView {
  state: string;
  runtime: string;
}

export interface InboxRowView {
  /** thread id — a row is one thread, not one item (U2). */
  id: string;
  name: string;
  timestamp: string;
  summary: string;
  isDraft: boolean;
  avatar: RowAvatar;
  channel: UiChannel;
  /** Non-null means "this is an agent session", which is what makes the row show a status badge
   *  instead of a channel mark. */
  agentState: AgentSessionKinsoState | null;
  unread: boolean;
  unreadCount: number;
  hasPendingApproval: boolean;
}

function firstLine(body: string): string {
  const idx = body.indexOf("\n");
  return (idx === -1 ? body : body.slice(0, idx)).trim();
}

/** The gmail adapter synthesises the subject into the head of the body as "Subject: ...\n\n"
 *  (NormalizedItem has no subject field). Mail-header text is not a summary. */
function stripSubjectHeader(body: string): string {
  if (!body.startsWith("Subject: ")) return body;
  const blank = body.indexOf("\n\n");
  return blank === -1 ? "" : body.slice(blank + 2);
}

/** A5 §3.1's fallback chain, unchanged: threads.meta.summary (T1) → subject → the body's first
 *  line; and the row is named after the person, then the thread, then the channel. */
export function threadSummary(row: {
  metaSummary?: string | null | undefined;
  subject?: string | null | undefined;
  body: string;
  title?: string | null | undefined;
}): string {
  if (row.metaSummary) return row.metaSummary;
  for (const candidate of [row.subject, firstLine(stripSubjectHeader(row.body))]) {
    if (candidate && candidate !== row.title) return candidate;
  }
  return "";
}

/** Pure, so the fallback rules can be tested without a Zero client. The query is sent_at desc, so
 *  a thread's first appearance is its newest item. */
export function toInboxRows(
  items: readonly InboxRowSource[],
  channelByAccount: ReadonlyMap<string, UiChannel>,
  approvalThreadIds: ReadonlySet<string>,
  now: number,
  sessionByThread: ReadonlyMap<string, SessionView> = new Map(),
): InboxRowView[] {
  const seen = new Set<string>();
  const rows: InboxRowView[] = [];
  for (const item of items) {
    if (seen.has(item.thread_id)) continue;
    seen.add(item.thread_id);
    const thread = item.thread;
    const session = sessionByThread.get(item.thread_id);
    const isSession = thread?.kind === "agent_session" && session !== undefined;
    const name =
      item.author?.display_name ??
      thread?.title ??
      channelByAccount.get(item.account_id) ??
      "omnis";
    const meta = thread?.meta as { summary?: string } | null | undefined;
    const summary = threadSummary({
      metaSummary: meta?.summary ?? null,
      subject: item.subject ?? null,
      body: item.body,
      title: thread?.title ?? null,
    });
    const unreadCount = thread?.unread_count ?? 0;
    rows.push({
      id: item.thread_id,
      name,
      timestamp: formatRelativeTime(item.sent_at, now),
      summary,
      isDraft: item.status === "draft",
      avatar: isSession
        ? { kind: "runtime", runtime: session.runtime as AgentRuntimeKind }
        : { kind: "initials", name },
      channel: channelByAccount.get(item.account_id) ?? "gmail",
      agentState: isSession ? agentSessionKinsoState(session.state) : null,
      unread: unreadCount > 0,
      unreadCount,
      hasPendingApproval: approvalThreadIds.has(item.thread_id),
    });
  }
  return rows;
}

export function Inbox({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (threadId: string) => void;
}) {
  const zero = useZeroClient();
  // Same shape as the desktop Inbox: items are taken sent_at desc and de-duplicated per thread on
  // the client, because ordering a `related` query is not supported by this Zero version (see the
  // longer note in apps/desktop/src/screens/Inbox.tsx). 60 is the phone's worth of history; the
  // list is not virtualized, so the window is also what keeps it cheap.
  const [items, itemsResult] = useQuery(
    zero.query.items
      .where("status", "!=", "archived")
      .orderBy("sent_at", "desc")
      .related("thread")
      .related("author")
      .limit(60),
  );
  const [accounts] = useQuery(zero.query.accounts);
  const [approvals] = useQuery(
    zero.query.pending_approvals.where("state", "=", "pending").limit(50),
  );
  const [sessions] = useQuery(zero.query.agent_sessions);
  const [runtimes] = useQuery(zero.query.agent_runtimes);

  const channelByAccount = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.channel as UiChannel])),
    [accounts],
  );
  const approvalThreadIds = useMemo(
    () => new Set(approvals.map((a) => a.thread_id).filter((id): id is string => id !== null)),
    [approvals],
  );
  const sessionByThread = useMemo(() => {
    const runtimeById = new Map(runtimes.map((r) => [r.id, r.runtime]));
    return new Map<string, SessionView>(
      sessions.map((s) => [
        s.thread_id,
        { state: s.state, runtime: runtimeById.get(s.runtime_id) ?? "claude_code" },
      ]),
    );
  }, [sessions, runtimes]);

  const rows = useMemo(
    () => toInboxRows(items, channelByAccount, approvalThreadIds, Date.now(), sessionByThread),
    [items, channelByAccount, approvalThreadIds, sessionByThread],
  );

  // `data-state` is what the screenshot tool reads: a frame of an empty list photographs just as
  // cleanly as a finished one, so the state has to be on the surface.
  const state = itemsResult.type !== "complete" ? "loading" : rows.length === 0 ? "empty" : "ready";

  return (
    <OpaqueSurface className="pwa-inbox" data-state={state}>
      {rows.length === 0 ? (
        <p className="pwa-inbox__empty">
          {state === "loading" ? "Loading your inbox…" : "Nothing in the inbox."}
        </p>
      ) : (
        // role="listbox" is the row grammar's container (InboxRow is role="option") — the same
        // pairing apps/desktop uses.
        // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useSemanticElements: A5 §3.1 listbox/option pattern — <select> cannot hold the rows' markup, and the focus belongs to the options inside (InboxRow is itself tabIndex=0), so a tabIndex here would only add a stray tab stop ahead of the first row.
        <div className="pwa-inbox__list" role="listbox" aria-label="Inbox">
          {rows.map((row) => (
            <InboxRow
              key={row.id}
              id={row.id}
              name={row.name}
              timestamp={row.timestamp}
              summary={row.summary}
              isDraft={row.isDraft}
              avatar={row.avatar}
              channel={row.channel}
              agentState={row.agentState}
              unread={row.unread}
              unreadCount={row.unreadCount}
              selected={row.id === selectedId}
              hasPendingApproval={row.hasPendingApproval}
              labels={[]}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </OpaqueSurface>
  );
}
