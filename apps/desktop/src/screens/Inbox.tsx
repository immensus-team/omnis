import {
  ArchiveIcon,
  BotIcon,
  BriefcaseIcon,
  CONFIRM_COPY,
  ClockIcon,
  ConfirmPrompt,
  type FilterChip,
  FilterChipBar,
  InboxIcon,
  OpaqueSurface,
  Sheet,
  SheetCheck,
  SheetGroup,
  SheetRow,
  type UiChannel,
  type UiItemStatus,
  UserIcon,
} from "@omnis/ui";
import { groupBy } from "@omnis/ui/components/command-palette";
import { GroupHeader } from "@omnis/ui/components/group-header";
import { InboxRow, type LabelChip, type RowAvatar } from "@omnis/ui/components/inbox-row";
import type { RelationshipState } from "@omnis/ui/components/person-card";
import { type AgentPillState, AgentStatusPill } from "@omnis/ui/components/status-pill";
import { LEAVE_MS, motionMs } from "@omnis/ui/lib/motion";
import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
import {
  type AgentRuntimeKind,
  type AgentSessionKinsoState,
  CHANNEL_LABEL,
  agentSessionKinsoState,
} from "@omnis/ui/lib/row-meta";
import { useQuery } from "@rocicorp/zero/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { setThreadArchived } from "../api/threads.js";
import { useKeymap } from "../hooks/use-keymap.js";
import { useZeroClient } from "../zero-client.js";

export const FILTERS = ["all", "work", "personal", "agents", "needs-approval"] as const;
export type InboxFilter = (typeof FILTERS)[number];

/** US-D08 §c.3: the chip's visible word. It is Title Case where the filter id is a slug —
 *  "needs-approval" is an id, never a label — and it is also the chip's accessible name, so the
 *  name is identical whether or not the container query has folded the word away. Exported because
 *  a test that spells "Agents" itself is a second copy of this map that fails for the wrong reason
 *  the day a label is reworded. */
export const FILTER_LABEL: Record<InboxFilter, string> = {
  all: "All",
  work: "Work",
  personal: "Personal",
  agents: "Agents",
  "needs-approval": "Needs approval",
};

/** US-D08 §c.3: one 16px glyph per chip, drawn at every width. Below 560px of list pane the label
 *  folds and the glyph is all that is left, which is why the row cannot be text-only. */
const FILTER_ICON: Record<InboxFilter, typeof InboxIcon> = {
  all: InboxIcon,
  work: BriefcaseIcon,
  personal: UserIcon,
  agents: BotIcon,
  "needs-approval": ClockIcon,
};

/** The minimum the shell (App.tsx) needs to pick a screen. Thread and AgentSession look at the
 *  same threads row, but only kind='agent_session' opens the session screen (A5 §3.3). */
export interface OpenTarget {
  threadId: string;
  agentSession: boolean;
}

export interface InboxQueryItem {
  id: string;
  scope: "work" | "personal" | "unknown";
  hasPendingApproval: boolean;
  authorKind: "person" | "agent" | "system";
}

/** A5 §2.1: the five filter pills are mutually exclusive (radio) and are views over combinations
 *  of items.status and labels.kind='scope'. */
export function filterInboxItems<T extends InboxQueryItem>(items: T[], filter: InboxFilter): T[] {
  switch (filter) {
    case "all":
      return items;
    case "work":
      return items.filter((i) => i.scope === "work");
    case "personal":
      return items.filter((i) => i.scope === "personal");
    case "agents":
      return items.filter((i) => i.authorKind === "agent");
    // This tab is an action queue, not an archive — only what is waiting on a decision right now
    // stays. Keeping decided and expired items too means the tab never empties (the lifecycle
    // deserves a view of its own, and there is not one yet).
    case "needs-approval":
      return items.filter((i) => i.hasPendingApproval);
  }
}

/** U2 row title: person display name -> thread title -> channel handle (thread.external_id) ->
 * placeholder, in exactly the order DESIGN-DIRECTION.md U2 specifies. (The older item.subject
 * fallback belonged to the days when a row was one item; from U2 a row is one thread and the spec
 * became this three-step chain.)
 * ponytail: personName only looks at the last item's sender, so a thread I replied to last falls
 * back to the thread title. Reading threads.participants to pick "the other person" is follow-up
 * scope. */
export function inboxRowTitle(row: {
  personName?: string | null;
  threadTitle?: string | null;
  channelHandle?: string | null;
}): string {
  return row.personName || row.threadTitle || row.channelHandle || "(no title)";
}

function firstLine(body: string): string {
  const idx = body.indexOf("\n");
  return (idx === -1 ? body : body.slice(0, idx)).trim();
}

/** The Gmail adapter synthesises the subject into the head of the body as "Subject: ...\n\n",
 * because NormalizedItem has no subject field (packages/adapters/gmail/src/index.ts). There is no
 * reason to put mail-header text into a row summary, so it is stripped. */
function stripSubjectHeader(body: string): string {
  if (!body.startsWith("Subject: ")) return body;
  const blank = body.indexOf("\n\n");
  return blank === -1 ? "" : body.slice(blank + 2);
}

/** U2 summary: threads.meta.summary (which B3 will fill) -> subject -> the last item's first
 * body line, skipping any candidate identical to the row title. Gmail and gcal build thread.title
 * out of the subject/summary (for gcal even the body is that same string) and Phase A never fills
 * author_person_id, so the row title also falls through to thread.title — left alone, one row
 * prints the same sentence twice. When the only candidate left is the title, the summary line is
 * empty (the grid's second row collapses to zero height and the row becomes one line). This path
 * disappears once B3 summaries land. */
export function threadSummary(row: {
  metaSummary?: string | null;
  subject?: string | null;
  body: string;
  title?: string | null;
}): string {
  if (row.metaSummary) return row.metaSummary;
  for (const candidate of [row.subject, firstLine(stripSubjectHeader(row.body))]) {
    if (candidate && candidate !== row.title) return candidate;
  }
  return "";
}

export interface ArchivableRow {
  threadId: string;
  /** threads.archived_at (ms). Null means it stays in the inbox (A5 §3.1's default query). */
  archivedAt: number | null;
}

/** US-A36: Inbox leaves archived threads out, and the Archived view shows only those, newest
 *  archived first. `pending` is the optimistic override (id -> archived?) that holds until the
 *  HTTP round trip and Zero replication arrive.
 *
 *  US-D04 `leaving` is the small hole in that rule: a thread that has just been archived (or
 *  restored) stays in whichever list it is currently leaving, for as long as the leave animation
 *  runs. Without it the row is filtered out on the same frame the click lands and there is nothing
 *  left to animate — the list snaps up by one row height and the row is simply gone. Inbox.tsx
 *  drops the id from the set when the animation ends, and the row then leaves by the normal rule.
 *  It is a parameter rather than a check inside the filter because it is a property of the *view*,
 *  not of a row: a leaving row is visible in both the inbox and the archived list. */
export function applyArchiveView<T extends ArchivableRow>(
  rows: T[],
  view: "inbox" | "archived",
  pending: Record<string, boolean>,
  leaving: ReadonlySet<string> = new Set(),
): T[] {
  const isArchived = (r: T): boolean => pending[r.threadId] ?? r.archivedAt !== null;
  const stays = (r: T): boolean => leaving.has(r.threadId);
  if (view === "inbox") return rows.filter((r) => stays(r) || !isArchived(r));
  return rows
    .filter((r) => stays(r) || isArchived(r))
    .sort(
      (a, b) =>
        (b.archivedAt ?? Number.MAX_SAFE_INTEGER) - (a.archivedAt ?? Number.MAX_SAFE_INTEGER),
    );
}

export interface SortableInboxRow {
  hasPendingApproval: boolean;
  agentState: AgentSessionKinsoState | null;
}

/** U2: rows that are a blocked agent session, or have a pending approval, go to the top;
 * everything else keeps its original (newest-first) order — Array.prototype.sort is stable
 * (ES2019+, V8), so rows with equal keys keep their input order. */
export function sortInboxRows<T extends SortableInboxRow>(rows: T[]): T[] {
  const needsAttention = (r: SortableInboxRow) =>
    r.hasPendingApproval || r.agentState === "blocked";
  return [...rows].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)));
}

/** blocked ("needs my reply") comes first — the herdr state model's order from
 * DESIGN-DIRECTION.md, unchanged. */
const AGENT_GROUP_ORDER: AgentPillState[] = ["blocked", "working", "idle", "done", "failed"];

/** An agent-authored row that is not an agent_session (agentState === null, e.g. a Slack message
 * an agent sent) has no state to group under a header — it is appended as a separate final
 * section, in its original order. */
export function groupByAgentState<T extends { agentState: AgentPillState | null }>(
  rows: T[],
): { groups: Array<{ state: AgentPillState; rows: T[] }>; ungrouped: T[] } {
  const grouped = rows.filter((r) => r.agentState !== null) as Array<
    T & { agentState: AgentPillState }
  >;
  const ungrouped = rows.filter((r) => r.agentState === null);
  const groups = groupBy(grouped, (r) => r.agentState);
  return {
    groups: AGENT_GROUP_ORDER.flatMap((s) => {
      const rows = groups[s];
      return rows?.length ? [{ state: s, rows }] : [];
    }),
    ungrouped,
  };
}

/** loop-r1-03/L-01: one step along the row order. A null `selectedId` — or one that is no longer in
 *  the list, e.g. the filter changed under it — reads as "nothing selected", and then **both**
 *  directions land on the first row: `k` with nothing selected does not jump to the bottom.
 *  At either end the selection stays put rather than wrapping; there is no loop to fall off.
 *  Pure, so the movement rule can be stated without a DOM. */
function stepRow(
  rowIds: readonly string[],
  selectedId: string | null,
  delta: 1 | -1,
): string | null {
  if (rowIds.length === 0) return null;
  const at = selectedId === null ? -1 : rowIds.indexOf(selectedId);
  if (at === -1) return rowIds[0] ?? null;
  return rowIds[at + delta] ?? selectedId;
}

/** loop-r1-03/L-02, NC-02: the row that takes the selection when `id` leaves the list — the one
 *  after it, or the one before it when it was last, or null when it was the only row. This is the
 *  whole of "`e` lands on the next thread": read from the list *as it still is*, because the
 *  archiving row is held in it for one leave animation (US-D04), so the id after it is the row the
 *  eye sees directly below rather than one that has already moved up. */
function neighbourAfter(rowIds: readonly string[], id: string): string | null {
  const at = rowIds.indexOf(id);
  if (at === -1) return null;
  return rowIds[at + 1] ?? rowIds[at - 1] ?? null;
}

/** One U2 row. Built by the threadRows memo and referenced again by the grouping flattener
 * (FlatItem). */
interface ThreadRow extends InboxQueryItem, ArchivableRow, SortableInboxRow {
  threadId: string;
  agentSession: boolean;
  title: string;
  summary: string;
  isDraft: boolean;
  channel: UiChannel;
  timestamp: string;
  /** US-D08 §c.3: the header subline's clock. `timestamp` is already a finished relative phrase and
   *  cannot be compared, so the raw value travels alongside it. */
  sentAt: number;
  unread: boolean;
  unreadCount: number;
  labels: LabelChip[];
  avatar: RowAvatar;
  /** US-D03: the author's person row (items.author), for the hover card's PersonCard. */
  person: { vip: boolean; relationshipState: RelationshipState } | null;
}

/** Virtuoso only takes a flat array — this folds group headers and rows into one stream. */
type FlatItem =
  | { kind: "header"; key: string; count: number; pill: ReactNode }
  | { kind: "row"; row: ThreadRow };

export function Inbox({
  onOpen,
  channelFilter = null,
  onChannelFilterChange,
  filtersOpen = false,
  onFiltersOpenChange,
  pendingApprovals = 0,
  onOpenApprovals,
}: {
  onOpen?: (target: OpenTarget) => void;
  /** U1 channel rail selection. null = everything (the Inbox tile). ANDed with the pill filters
   *  (work/personal/...). */
  channelFilter?: UiChannel | null;
  /** US-D02: how the channel chip's x undoes the rail selection. Without it the channel chip is
   *  not drawn at all — an x that does nothing is worse than no x. */
  onChannelFilterChange?: (c: UiChannel | null) => void;
  /** US-D09 §c.6: M125's sheet, opened by the BottomBar's filters circle. It is controlled from the
   *  shell because the trigger is the shell's bar, while the state it edits (the filter pill, the
   *  Archived view, the label chips) is this screen's. */
  filtersOpen?: boolean;
  onFiltersOpenChange?: (open: boolean) => void;
  /** loop-r1-02/L-04: how many approvals are waiting, and how to get to them. The queue is the
   *  shell's pane, so the list can neither open nor count it by itself — what the list can do is say
   *  it exists. Below 1280 this is the *only* way the pane opens on the queue (it no longer opens
   *  itself there), and at >=1280 it is the way back after the user has collapsed the pane. */
  pendingApprovals?: number;
  onOpenApprovals?: () => void;
}) {
  const zero = useZeroClient();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"inbox" | "archived">("inbox");
  // Optimistic override: keeps the row from sitting there unchanged until the hub round trip and
  // Zero replication arrive.
  const [pendingArchive, setPendingArchive] = useState<Record<string, boolean>>({});
  /** US-D04: threads that have just been archived or restored and are still playing their leave
   *  animation. See applyArchiveView's `leaving` for why the row has to stay in the data. */
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(new Set());
  const leaveTimers = useRef<number[]>([]);
  // US-D02: the label chip filter. An empty Set means no label condition (it is ANDed with the
  // others).
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(new Set());
  /** US-D09 §c.8: the bulk action's confirmation. It holds the **ids** the question named rather
   *  than a count or a boolean: the question says "Archive 3 threads?" and confirming has to archive
   *  those three, not whatever is on screen a replication later. */
  const [archiveAll, setArchiveAll] = useState<string[] | null>(null);

  // Deviation from plan A26 step 7, measured against interface contract §7's zeroSchema: the
  // zeroSchema (A21, packages/kernel/src/zero-schema.ts) defines only the three relations
  // Inbox/Thread actually use (threads.items, items.thread, items.author). There is no
  // items.labels relation — labels attach to threads through thread_labels, not to items (A5 §3.1,
  // the label chip spec). Channels, approval badges and labels therefore query their own tables
  // and are joined by id on the client rather than through relations.
  //
  // U2 deviation: the thread list is built by de-duplicating this items query per thread on the
  // client, not by zero.query.threads. The zeroSchema does have a threads->items relation, but
  // asking the server for "the newest item per thread" by putting orderBy+limit on that relation
  // is unverified in this Zero version (1.9.0) — the zql AST's Ordering type comment states that
  // ordering outside the root query is not supported yet, which makes it a risk. Taking items in
  // sent_at desc order and keeping each thread_id's first appearance is a query shape already
  // proven to work, so it is reused as-is. ponytail: a thread with several messages inside the
  // top-N can push another thread out (the limit is 200 to leave slack) — if a true "newest per
  // thread" is ever needed, verify the threads.related("items", limit 1) path and switch.
  const [items] = useQuery(
    zero.query.items
      .where("status", "!=", "archived")
      .orderBy("sent_at", "desc")
      .related("thread")
      .related("author")
      .limit(200),
  );
  const [accounts] = useQuery(zero.query.accounts);
  // Exactly what the name says: pending only. Replicating the whole lifecycle grows the client's
  // approvals table without bound, while the only question the inbox actually asks is what is
  // waiting on a decision right now.
  // loop-r1-02: `pendingApprovalRows`, not `pendingApprovals` — that name is the prop above, and the
  // two are the same number by different routes. The prop is the shell's count (its own query, and
  // the one the pane draws); this is the *rows*, which is what the per-row approval dot needs. They
  // agree because both ask for state='pending'.
  const [pendingApprovalRows] = useQuery(
    zero.query.pending_approvals
      .where("state", "=", "pending")
      .orderBy("created_at", "desc")
      .limit(200),
  );
  const [labels] = useQuery(zero.query.labels);
  const [threadLabels] = useQuery(zero.query.thread_labels);
  const [agentSessions] = useQuery(zero.query.agent_sessions);
  const [agentRuntimes] = useQuery(zero.query.agent_runtimes);

  const channelByAccount = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.channel as UiChannel])),
    [accounts],
  );
  // One approval per thread, the most recent. The query is created_at desc, so the first
  // appearance is the newest.
  const approvalByThread = useMemo(() => {
    const best = new Map<string, (typeof pendingApprovalRows)[number]>();
    for (const approval of pendingApprovalRows) {
      if (!approval.thread_id) continue;
      if (!best.has(approval.thread_id)) best.set(approval.thread_id, approval);
    }
    return best;
  }, [pendingApprovalRows]);
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const chipsByThread = useMemo(() => {
    const map = new Map<string, LabelChip[]>();
    for (const tl of threadLabels) {
      const label = labelById.get(tl.label_id);
      if (!label) continue;
      const chip: LabelChip = {
        kind: label.kind as LabelChip["kind"],
        name: label.name,
        color: label.color ?? null,
      };
      const existing = map.get(tl.thread_id);
      if (existing) existing.push(chip);
      else map.set(tl.thread_id, [chip]);
    }
    return map;
  }, [threadLabels, labelById]);
  const sessionByThread = useMemo(
    () => new Map(agentSessions.map((s) => [s.thread_id, s])),
    [agentSessions],
  );
  const runtimeById = useMemo(
    () => new Map(agentRuntimes.map((r) => [r.id, r.runtime as AgentRuntimeKind])),
    [agentRuntimes],
  );

  // U2: de-duplicate the item stream per thread (sent_at desc, so a thread_id's first appearance
  // is its newest item).
  const threadRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: ThreadRow[] = [];
    for (const item of items) {
      if (seen.has(item.thread_id)) continue;
      seen.add(item.thread_id);
      const isAgentSession = item.thread?.kind === "agent_session";
      const session = sessionByThread.get(item.thread_id);
      const agentState = isAgentSession && session ? agentSessionKinsoState(session.state) : null;
      // The query takes state='pending' only (pending_approvals above), so existence means it is
      // waiting on a decision.
      const hasPendingApproval = approvalByThread.has(item.thread_id);
      const runtime = session ? runtimeById.get(session.runtime_id) : undefined;
      const authorKind: InboxQueryItem["authorKind"] = isAgentSession
        ? "agent"
        : item.author_agent_id
          ? "agent"
          : item.author_person_id
            ? "person"
            : "system";
      const title = inboxRowTitle({
        personName: item.author?.display_name ?? null,
        threadTitle: item.thread?.title ?? null,
        channelHandle: item.thread?.external_id ?? null,
      });
      rows.push({
        id: item.thread_id,
        threadId: item.thread_id,
        agentSession: isAgentSession,
        scope: item.scope as InboxQueryItem["scope"],
        authorKind,
        hasPendingApproval,
        title,
        summary: threadSummary({
          metaSummary: (item.thread?.meta as { summary?: string } | null)?.summary ?? null,
          subject: item.subject ?? null,
          body: item.body,
          title,
        }),
        isDraft: (item.status as UiItemStatus) === "draft",
        channel: channelByAccount.get(item.account_id) ?? "system",
        timestamp: formatRelativeTime(item.sent_at),
        sentAt: item.sent_at,
        unread: (item.thread?.unread_count ?? 0) > 0,
        unreadCount: item.thread?.unread_count ?? 0,
        labels: chipsByThread.get(item.thread_id) ?? [],
        avatar:
          runtime !== undefined ? { kind: "runtime", runtime } : { kind: "initials", name: title },
        // The persons row travels with items.author, so the hover card's relationship state and
        // VIP chip are read, not guessed. Authorless rows (agent sessions, system) have none.
        person: item.author
          ? {
              vip: item.author.vip,
              relationshipState: item.author.relationship_state as RelationshipState,
            }
          : null,
        agentState,
        archivedAt: item.thread?.archived_at ?? null,
      });
    }
    return rows;
  }, [items, approvalByThread, channelByAccount, chipsByThread, sessionByThread, runtimeById]);

  // Once the server state catches up with the override, the override is dropped — otherwise a
  // later auto-archive (A4 §9), or a Restore performed on another device, would be ignored here.
  useEffect(() => {
    setPendingArchive((prev) => {
      const settled = threadRows.filter((r) => prev[r.threadId] === (r.archivedAt !== null));
      if (settled.length === 0) return prev;
      const next = { ...prev };
      for (const r of settled) delete next[r.threadId];
      return next;
    });
  }, [threadRows]);

  // One toggle, two call sites: the "+ Label" popover and §c.6's sheet edit the same Set, and a
  // second copy of this is where the two would start disagreeing.
  const toggleLabel = useCallback((id: string) => {
    setSelectedLabelIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleArchive = useCallback((threadId: string, archived: boolean) => {
    // US-D04: the row is held in the list for one leave animation. The server call goes out
    // immediately rather than after the animation — the round trip overlaps the 240ms instead of
    // queueing behind it, and the optimistic state below still lands on the same frame as the
    // click, so nothing about the archive is slower than it was.
    setLeavingIds((s) => new Set(s).add(threadId));
    setPendingArchive((p) => ({ ...p, [threadId]: archived }));
    leaveTimers.current.push(
      window.setTimeout(() => {
        setLeavingIds((s) => {
          if (!s.has(threadId)) return s;
          const next = new Set(s);
          next.delete(threadId);
          return next;
        });
      }, motionMs(LEAVE_MS)),
    );
    setThreadArchived(threadId, archived).catch((e: unknown) => {
      // If the hub refuses, the optimistic state is rolled back — the screen does not get to lie
      // ahead of the server. The row comes back on the next render, so the leave animation is cut
      // short; that is the right way round (a failed archive should not keep showing the row
      // sliding away).
      setPendingArchive((p) => {
        const next = { ...p };
        delete next[threadId];
        return next;
      });
      setLeavingIds((s) => {
        if (!s.has(threadId)) return s;
        const next = new Set(s);
        next.delete(threadId);
        return next;
      });
      console.error("archive failed", e);
    });
  }, []);

  // The leave timers outlive a row that unmounts first (archiving the last row and switching views,
  // or closing the window mid-animation). A pending timer that fires after unmount would call
  // setState on a dead component, so they are cleared together on the way out.
  useEffect(
    () => () => {
      for (const timer of leaveTimers.current) window.clearTimeout(timer);
    },
    [],
  );

  const channelFiltered = useMemo(
    () => (channelFilter ? threadRows.filter((r) => r.channel === channelFilter) : threadRows),
    [threadRows, channelFilter],
  );
  const pillFiltered = useMemo(
    () => filterInboxItems(channelFiltered, filter),
    [channelFiltered, filter],
  );
  // US-D02 label chips: a thread passes if any of its thread_labels is one of the chosen labels.
  // With nothing chosen this stage disappears entirely — filtering against an empty Set would
  // reject everything, which is the default-value trap.
  const labelFiltered = useMemo(() => {
    if (selectedLabelIds.size === 0) return pillFiltered;
    const matching = new Set<string>();
    for (const tl of threadLabels) {
      if (selectedLabelIds.has(tl.label_id)) matching.add(tl.thread_id);
    }
    return pillFiltered.filter((r) => matching.has(r.threadId));
  }, [pillFiltered, threadLabels, selectedLabelIds]);
  const viewFiltered = useMemo(
    () => applyArchiveView(labelFiltered, view, pendingArchive, leavingIds),
    [labelFiltered, view, pendingArchive, leavingIds],
  );
  // Archived sorts by archive time, newest first — it does not pull needs-attention to the top.
  const filtered = useMemo(
    () => (view === "archived" ? viewFiltered : sortInboxRows(viewFiltered)),
    [viewFiltered, view],
  );

  // US-D02 filter chips. The chip wording is finished here and handed over — FilterChipBar knows
  // nothing about channels or labels.
  const chips: FilterChip[] = [];
  if (channelFilter && onChannelFilterChange) {
    chips.push({
      id: "channel",
      field: "Channel",
      value: CHANNEL_LABEL[channelFilter],
      onRemove: () => onChannelFilterChange(null),
    });
  }
  if (selectedLabelIds.size > 0) {
    chips.push({
      id: "labels",
      field: "Label",
      // The reference's filter DSL collapses the quantifier for a single value too ("Channel is
      // Slack") — "one of 1" is not something a person writes, so like the channel chip only the
      // name is left.
      value:
        selectedLabelIds.size === 1
          ? (labels.find((l) => selectedLabelIds.has(l.id))?.name ?? "1")
          : `one of ${selectedLabelIds.size}`,
      onRemove: () => setSelectedLabelIds(new Set()),
    });
  }
  const addOptions = {
    fieldLabel: "Label",
    options: labels.map((l) => ({ id: l.id, label: l.name })),
    selectedIds: [...selectedLabelIds],
    onToggle: toggleLabel,
  };

  // US-D02: grouping happens in the agents view only. needs-approval queries pending alone
  // (pending_approvals' `.where(state, pending)` above), so there is always exactly one group and
  // a header band would repeat the name of the tab just chosen without carrying any information —
  // only the number folds into the tab pill (pendingCount below). Archived stays flat too: laying
  // state groups over its own sort axis (archive time, newest first) makes the two fight.
  const grouped = view === "inbox" && filter === "agents";
  const listItems = useMemo<FlatItem[]>(() => {
    if (!grouped) return filtered.map((row) => ({ kind: "row", row }));
    // agents: rows with no session state (a Slack message an agent sent, say) are appended at the
    // end with no header.
    const { groups, ungrouped } = groupByAgentState(filtered);
    return [
      ...groups.flatMap((g) => [
        {
          kind: "header" as const,
          key: `agent-${g.state}`,
          count: g.rows.length,
          pill: <AgentStatusPill state={g.state} />,
        },
        ...g.rows.map((row) => ({ kind: "row" as const, row })),
      ]),
      ...ungrouped.map((row) => ({ kind: "row" as const, row })),
    ];
  }, [filtered, grouped]);

  /** loop-r1-03/L-01: the row order — the ids of the `listItems` entries that are rows, in display
   *  order. Group headers are skipped, so "the next row" is never a header band, and the order read
   *  is the *displayed* one rather than the thread list's own: needs-attention rows float to the top
   *  of the inbox and the archived view sorts by archive time, so neither matches the query order.
   *  This is the list's axis for `j`/`k`, the arrows, Home/End and the archive advance. */
  const rowIds = useMemo(
    () => listItems.flatMap((item) => (item.kind === "row" ? [item.row.id] : [])),
    [listItems],
  );

  /** loop-r1-03: the scroller, so `moveTo` can bring a row the window has not reached into view
   *  before it puts the focus on it. The rows live inside the virtualiser, so this ref is the only
   *  way to address one by index — the screen holds no other handle on the list. */
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  /** loop-r1-03: the one way the selection moves, and it does three things: select, scroll the row
   *  into view, and put the focus on it.
   *
   *  The scroll finds the row's index in `listItems` — the flat stream, not `rowIds` — because that
   *  is what Virtuoso's `scrollIntoView` addresses: a group header occupies an index too, and an
   *  offset taken from the rows alone would land one item short for every header above it.
   *
   *  The focus is deferred to the next frame, and that is load-bearing rather than polite. Moving
   *  past the bottom of the window selects a row the virtualiser has not mounted yet — it mounts it
   *  in the same commit — so `querySelector` this frame would find nothing, the focus would not
   *  move, and with a roving tab stop the next Tab would start from somewhere else entirely.
   *
   *  Moving does **not** open the pane. Enter and a click do that, through the row's own `onSelect`,
   *  and that is the difference between reading the queue with `j` and opening three threads. */
  const moveTo = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (id === null) return;
      const index = listItems.findIndex((item) => item.kind === "row" && item.row.id === id);
      // behavior "auto": the selection moves instantly. A smooth scroll would still be travelling
      // when the next `j` lands, so the row under the focus and the row under the eye would part.
      if (index !== -1) virtuosoRef.current?.scrollIntoView({ index, behavior: "auto" });
      requestAnimationFrame(() => {
        const row = document.querySelector(`[data-thread-id="${id}"]`);
        if (row instanceof HTMLElement) row.focus();
      });
    },
    [listItems],
  );

  /** loop-r1-03/L-02, NC-02: archive (or restore) and move on. Both `e`/`u` and the row's own
   *  Archive button come through here, so the keyboard and the mouse cannot disagree about where
   *  the selection lands; the bug was that it stayed on the row that had just left, so the next `e`
   *  posted the same id again. The neighbour is read from `rowIds` as it *still* is — the leaving
   *  row is held in the list for its 240ms animation (US-D04), so the id after it is the row the
   *  eye sees directly below rather than one that has already moved up.
   *  The advance only happens when the row that left is the selected one: archiving some other row
   *  from the mouse must not steal the selection from the thread being read. */
  const archiveAndAdvance = useCallback(
    (threadId: string, archived: boolean) => {
      const next = neighbourAfter(rowIds, threadId);
      toggleArchive(threadId, archived);
      if (threadId === selectedId) moveTo(next);
    },
    [rowIds, selectedId, toggleArchive, moveTo],
  );

  useKeymap(
    useCallback(
      (action: string) => {
        // The movement keys read "nothing selected" as "start at the top" and are answered before
        // the guard below: `j` on a list nobody has clicked into has to land on the first row, or
        // the keyboard could never enter the list at all (L-01).
        if (action === "next-row") {
          moveTo(stepRow(rowIds, selectedId, 1));
          return;
        }
        if (action === "prev-row") {
          moveTo(stepRow(rowIds, selectedId, -1));
          return;
        }
        // Nothing happens when nothing is selected: archive and restore are the selection's own
        // keys, and `j` is what gives them something to act on.
        if (selectedId === null) return;
        // `e` archives in the inbox and `u` restores in the Archived view. Each is scoped to its own
        // view rather than acting in both: `e` on an already-archived row is a write the server does
        // not need, and this story is triage rather than a second Restore binding (L-02).
        if (action === "archive" && view === "inbox") archiveAndAdvance(selectedId, true);
        if (action === "unarchive" && view === "archived") archiveAndAdvance(selectedId, false);
      },
      [rowIds, selectedId, view, moveTo, archiveAndAdvance],
    ),
  );

  /** loop-r1-03/L-19: the arrow keys, Home and End belong to the *list*, so they are handled on the
   *  list rather than in the global keymap, which listens on `window`. A window-level ArrowDown
   *  cannot tell a press made with the focus on a row from one made inside the filter pills'
   *  popover or the "+ Label" menu, and the arrows have to keep working as those surfaces' own key
   *  (arrow movement across the radio pills is a finding of its own). `onKeyDown` here only sees
   *  presses made with the focus inside the list, which is exactly the scope this story asks for.
   *  Only these four keys are claimed, so Enter still reaches the row that owns it. */
  const onListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = (delta: 1 | -1): void => {
      e.preventDefault();
      moveTo(stepRow(rowIds, selectedId, delta));
    };
    if (e.key === "ArrowDown") step(1);
    else if (e.key === "ArrowUp") step(-1);
    else if (e.key === "Home") {
      e.preventDefault();
      moveTo(rowIds[0] ?? null);
    } else if (e.key === "End") {
      e.preventDefault();
      moveTo(rowIds[rowIds.length - 1] ?? null);
    }
  };

  /** loop-r1-03/NC-18: the row that holds the list's single tab stop — the selected one, or the
   *  first when nothing is selected or the selection is no longer in the list (the filter changed
   *  under it). Derived rather than stored, so it cannot disagree with what is on screen: `rowIds`
   *  is the same array the movement and the keys read. */
  const tabStopId =
    selectedId !== null && rowIds.includes(selectedId) ? selectedId : (rowIds[0] ?? null);

  // The needs-approval tab's count. It only means anything if it is the same number whether or
  // not the tab is selected, so it is counted **before** the pill filter — from `channelFiltered`,
  // the last stage upstream of it. (It read `labelFiltered`, which looks pre-pill and is not: that
  // stage returns `pillFiltered` untouched when no label is chosen, so the count was taken after
  // the pill after all. The badge then vanished on every tab whose own rows carry no approval —
  // the agents view advertised no queue while both waiting threads sat one tab away.) At zero it
  // is not drawn: an empty queue is said by an empty list, not by a badge.
  const pendingCount = useMemo(
    () =>
      applyArchiveView(channelFiltered, view, pendingArchive).filter((r) => r.hasPendingApproval)
        .length,
    [channelFiltered, view, pendingArchive],
  );

  // US-D08 §c.3: the subline under the title. Same three segments Mail shows, in that order, with
  // any segment that has nothing to say removed — and, because it is a join over a filtered array,
  // a separator can never be left dangling without a segment after it.
  // The clock is the newest item **on screen**, not the newest in the mailbox: filtered down to a
  // quiet channel, "Updated 2h" over a list of two-day-old rows would be advertising freshness the
  // list below does not have.
  // ponytail: the channel segment only appears when exactly one account is connected. With several
  // there is no single account to name, and Mail's answer (the unified "All Inboxes" title) is a
  // separate feature.
  const latestSentAt = filtered.length === 0 ? null : Math.max(...filtered.map((r) => r.sentAt));
  const unreadOnScreen = filtered.reduce((n, r) => n + (r.unread ? 1 : 0), 0);
  const soleAccount = accounts.length === 1 ? accounts[0] : undefined;
  const accountChannel = soleAccount ? CHANNEL_LABEL[soleAccount.channel as UiChannel] : null;
  const subline = [
    channelFilter ? CHANNEL_LABEL[channelFilter] : accountChannel,
    latestSentAt === null ? null : `Updated ${formatRelativeTime(latestSentAt)}`,
    // Dropped at zero: an empty queue is said by an empty list, the rule the needs-approval count
    // badge already follows.
    unreadOnScreen > 0 ? `${unreadOnScreen} unread` : null,
  ]
    .filter((segment): segment is string => segment !== null)
    .join(" · ");

  return (
    <OpaqueSurface className="inbox-card">
      <div className="inbox-card__header">
        <h2 className="inbox-card__title">{view === "archived" ? "Archived" : "Inbox"}</h2>
        {/* loop-r1-02/L-04: the queue's entry point. It is a fourth segment of the subline rather
            than a control of its own, because that is where Mail puts "N unread" and a person
            looking for what is waiting looks there. It is inline, so the line keeps the height of
            one line of 13px whether or not the count is there — the header must not jump as the
            last approval is decided (L-32). The `<p>` itself is still conditional: with nothing to
            say at all there is no line, which is what the list has always done. */}
        {(subline !== "" || (pendingApprovals > 0 && onOpenApprovals !== undefined)) && (
          <p className="inbox-card__subline">
            {subline}
            {pendingApprovals > 0 && onOpenApprovals !== undefined && (
              <>
                {subline !== "" && " · "}
                <button type="button" className="inbox-card__approvals" onClick={onOpenApprovals}>
                  {pendingApprovals === 1
                    ? "1 needs approval"
                    : `${pendingApprovals} need approval`}
                </button>
              </>
            )}
          </p>
        )}
      </div>
      {/* US-D02b: this one line under the title is the whole filter UI — the view pills, the
          Archived toggle and the label chips used to scatter over three lines (that is the
          screenshot where the chips folded into a pile) and are now a single horizontally
          scrolling strip. Narrow does not wrap it, it slides; app.css's container query is what
          folds every inactive chip down to its icon (US-D08 §c.3). */}
      <div className="inbox-card__filter-row">
        {/* Active label chips lead the strip. They used to sit after five always-present view
            pills, so at 390px the chip currently filtering the list — and its x — scrolled off the
            right edge behind the fade: a list cut to one row with nothing on screen saying why.
            What is filtering must never be the first thing to scroll away. The order is DOM order,
            not CSS `order`, so the tab sequence matches what the eye reads.
            The chips and the "+" trigger are two bars rather than one moved bar: the trigger owns
            an open popover, and remounting it at a different position the moment the first chip
            appears tears that popover down mid-selection, which kills multi-select. */}
        {chips.length > 0 && <FilterChipBar chips={chips} />}
        <div role="radiogroup" aria-label="Inbox filters" className="inbox-card__pills">
          {FILTERS.map((f) => {
            const Icon = FILTER_ICON[f];
            return (
              <button
                key={f}
                type="button"
                // biome-ignore lint/a11y/useSemanticElements: A5 §2.1 filter pill — <input type="radio"> can't render a pill label+count.
                role="radio"
                aria-checked={filter === f}
                // US-D08 §c.3: the accessible name is the label, stated here rather than inherited
                // from the chip's contents — below 560px of list pane the container query folds the
                // word away, leaving an icon-only chip whose name would otherwise collapse with it.
                // It also keeps the pending count out of the name ("Needs approval 2" announces the
                // queue twice, once as a number nobody asked for).
                aria-label={FILTER_LABEL[f]}
                onClick={() => setFilter(f)}
              >
                <Icon size={16} aria-hidden="true" />
                <span className="inbox-card__chip-label">{FILTER_LABEL[f]}</span>
                {f === "needs-approval" && pendingCount > 0 && (
                  <span className="inbox-card__pill-count">{pendingCount}</span>
                )}
              </button>
            );
          })}
        </div>
        {/* US-A36: the Archived pill. Unlike the filter pills (radio) it is a toggle, so it sits
            outside the radiogroup. US-D08 §c.3: a 32px circle at the row's end, icon-only at every
            width — the word went with the label element, and the name now lives in aria-label and
            the title. */}
        <button
          type="button"
          className="inbox-card__archived-pill"
          aria-pressed={view === "archived"}
          aria-label="Archived"
          title="Archived"
          onClick={() => setView((v) => (v === "archived" ? "inbox" : "archived"))}
        >
          <ArchiveIcon size={16} aria-hidden="true" />
        </button>
        {/* The "+ Label" trigger keeps the end of the strip whatever is filtering. A workspace
            with no labels at all gets no bar — an empty strip is a control with nothing to
            press. */}
        {labels.length > 0 && <FilterChipBar chips={[]} addOptions={addOptions} />}
      </div>
      {/* loop-r1-03: the wrapper exists to scope four keys — see onListKeyDown. It carries no
          tabindex of its own: the list's tab stop is the selected row, and the wrapper is not a
          stop at all (NC-18 counted the "list wrapper (no visible focus)" as one). */}
      <div className="inbox-card__list" onKeyDown={onListKeyDown}>
        <Virtuoso
          ref={virtuosoRef}
          role="listbox"
          // loop-r1-03/NC-18: react-virtuoso puts tabIndex={0} on its scroller by default, which is
          // the focusable-but-invisible stop the keyboard-only session counted. Taking it out
          // leaves the list exactly one tab stop, on the selected row.
          tabIndex={-1}
          style={{ flex: "1 1 0", minHeight: 0 }}
          data={listItems}
          // loop-r1-03: the row's identity, so React moves a row's DOM node with the row instead of
          // reusing whatever node sat at that position. Without it, archiving a row shifts every row
          // below it up one *position*, React reconciles the virtualiser's children by position,
          // and the node that held the focus is handed to a different thread: the focus ring lands
          // on a row nobody selected and a screen reader reads the wrong one. Measured, not
          // theorised — shots-loop-r1-03 read the focus on b3a8cee8 while the selection was on
          // 46ed6e45. The header half of the union already carries its own stable key (FlatItem).
          computeItemKey={(_, item) => (item.kind === "header" ? item.key : item.row.id)}
          itemContent={(index, item) =>
            item.kind === "header" ? (
              <GroupHeader pill={item.pill} count={item.count} />
            ) : (
              <InboxRow
                // US-D08 §c.4: only the row at the end of the list drops its hairline. The index
                // is the flat list index, and the last item is always a row — a group header is
                // only ever emitted above the rows it counts.
                last={index === listItems.length - 1}
                id={item.row.id}
                name={item.row.title}
                summary={item.row.summary}
                isDraft={item.row.isDraft}
                avatar={item.row.avatar}
                channel={item.row.channel}
                // When the group header directly above states the status, the row does not say it
                // again (ref-issue-tracker-density.webp also keeps state words in the header
                // only). What it does not do is erase the fact that this is a session —
                // overwriting agentState with null drops a runtime session row to a channel glyph
                // and it starts calling itself a "Slack message" (round three's rejection).
                agentState={item.row.agentState}
                groupedByState={grouped}
                timestamp={item.row.timestamp}
                unread={item.row.unread}
                unreadCount={item.row.unreadCount}
                selected={item.row.id === selectedId}
                // On the needs-approval tab every row is pending — repeating with a dot per row
                // what the tab already said makes the dot distinguish nothing (the same rule as
                // dropping the status badge under a group header: what is stated above is not
                // repeated below).
                hasPendingApproval={filter !== "needs-approval" && item.row.hasPendingApproval}
                labels={item.row.labels}
                person={item.row.person}
                archived={view === "archived"}
                leaving={leavingIds.has(item.row.id)}
                // loop-r1-03: one Tab reaches the list and it lands on the selected row; every
                // other row is one `j` away instead. See tabStopId.
                tabStop={item.row.id === tabStopId}
                // Focus *is* selection — a Tab into the list, Escape's focus restore and a row
                // focused in another window all arrive here, and none of them opens the pane.
                onFocusRow={setSelectedId}
                // The mouse path takes the same advance as `e`: one archive rule, two triggers.
                onArchive={(id) => archiveAndAdvance(id, view !== "archived")}
                onSelect={(id) => {
                  setSelectedId(id);
                  onOpen?.({ threadId: item.row.threadId, agentSession: item.row.agentSession });
                }}
              />
            )
          }
        />
      </div>
      {/* US-D09 §c.6: M125's Filters sheet. It is a sibling of the prompt below rather than its
          ancestor, and that is load-bearing — both portal to <body>, and React bubbles a synthetic
          event through the **React** tree, so a prompt rendered inside the sheet would deliver its
          own Escape and Tab to the sheet's trap as well. They are two surfaces, so they are two
          branches.
          The rows apply as they are pressed (that is what M125's checkmarks mean), which makes
          Done a dismissal and not a commit — hence a no-op confirm rather than a copy of the
          filter state to write back. */}
      {onFiltersOpenChange && (
        <Sheet
          open={filtersOpen}
          onOpenChange={onFiltersOpenChange}
          title="Filters"
          confirm={{ label: "Done", onConfirm: () => {} }}
        >
          <SheetGroup label="Show">
            {FILTERS.map((f) => (
              <SheetRow
                key={f}
                // biome-ignore lint/a11y/useSemanticElements: M125's rows are 48px card rows closed by a check — an <input type="radio"> cannot render one, and the role is what carries the semantics into the sheet's own grammar.
                role="radio"
                checked={filter === f}
                trailing={<SheetCheck checked={filter === f} />}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABEL[f]}
              </SheetRow>
            ))}
          </SheetGroup>
          {/* The Archived toggle is a view, not a sixth filter pill: the pills are radio (mutually
              exclusive by construction) and it is a checkbox — the same distinction the strip's own
              circle makes by sitting outside the radiogroup. */}
          <SheetGroup label="View">
            <SheetRow
              // biome-ignore lint/a11y/useSemanticElements: the same call as the rows above — the toggle is a sheet row, not a bare <input type="checkbox">.
              role="checkbox"
              checked={view === "archived"}
              trailing={<SheetCheck checked={view === "archived"} />}
              onClick={() => setView((v) => (v === "archived" ? "inbox" : "archived"))}
            >
              Archived threads
            </SheetRow>
          </SheetGroup>
          {labels.length > 0 && (
            <SheetGroup label="Labels">
              {labels.map((l) => (
                <SheetRow
                  key={l.id}
                  // biome-ignore lint/a11y/useSemanticElements: a sheet row again — the label names a Set membership, and the row is what M125 draws it in.
                  role="checkbox"
                  checked={selectedLabelIds.has(l.id)}
                  trailing={<SheetCheck checked={selectedLabelIds.has(l.id)} />}
                  onClick={() => toggleLabel(l.id)}
                >
                  {l.name}
                </SheetRow>
              ))}
            </SheetGroup>
          )}
          {/* The bulk action, and the only thing in this sheet that is not reversible by pressing
              the row again — so it is the one that asks (§c.8). With nothing on screen there is
              nothing to archive and the group is not drawn: an "Archive 0 threads?" question is a
              control with nothing to act on. */}
          {view === "inbox" && filtered.length > 0 && (
            <SheetGroup label="Actions">
              <SheetRow onClick={() => setArchiveAll(filtered.map((r) => r.threadId))}>
                {`Archive all ${filtered.length} shown`}
              </SheetRow>
            </SheetGroup>
          )}
        </Sheet>
      )}
      {/* §c.8: the title is the whole question and it names the count, while the list it will act
          on was frozen when the question was asked. */}
      <ConfirmPrompt
        open={archiveAll !== null}
        onOpenChange={(open) => !open && setArchiveAll(null)}
        {...CONFIRM_COPY.archiveThreads(archiveAll?.length ?? 0)}
        confirmLabel="Archive"
        onConfirm={() => {
          for (const threadId of archiveAll ?? []) toggleArchive(threadId, true);
        }}
      />
    </OpaqueSurface>
  );
}
