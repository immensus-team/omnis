import {
  ArchiveIcon,
  BotIcon,
  BriefcaseIcon,
  ClockIcon,
  type FilterChip,
  FilterChipBar,
  InboxIcon,
  OpaqueSurface,
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
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
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
}: {
  onOpen?: (target: OpenTarget) => void;
  /** U1 channel rail selection. null = everything (the Inbox tile). ANDed with the pill filters
   *  (work/personal/...). */
  channelFilter?: UiChannel | null;
  /** US-D02: how the channel chip's x undoes the rail selection. Without it the channel chip is
   *  not drawn at all — an x that does nothing is worse than no x. */
  onChannelFilterChange?: (c: UiChannel | null) => void;
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
  const [pendingApprovals] = useQuery(
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
    const best = new Map<string, (typeof pendingApprovals)[number]>();
    for (const approval of pendingApprovals) {
      if (!approval.thread_id) continue;
      if (!best.has(approval.thread_id)) best.set(approval.thread_id, approval);
    }
    return best;
  }, [pendingApprovals]);
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

  useKeymap(
    useCallback(
      (action: string) => {
        if (selectedId === null) return;
        if (action === "archive") toggleArchive(selectedId, true);
        if (action === "unarchive") toggleArchive(selectedId, false);
      },
      [selectedId, toggleArchive],
    ),
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
    onToggle: (id: string) =>
      setSelectedLabelIds((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
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
        {subline && <p className="inbox-card__subline">{subline}</p>}
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
      <Virtuoso
        role="listbox"
        style={{ flex: "1 1 0", minHeight: 0 }}
        data={listItems}
        itemContent={(_, item) =>
          item.kind === "header" ? (
            <GroupHeader pill={item.pill} count={item.count} />
          ) : (
            <InboxRow
              id={item.row.id}
              name={item.row.title}
              summary={item.row.summary}
              isDraft={item.row.isDraft}
              avatar={item.row.avatar}
              channel={item.row.channel}
              // When the group header directly above states the status, the row does not say it
              // again (ref-issue-tracker-density.webp also keeps state words in the header only).
              // What it does not do is erase the fact that this is a session — overwriting
              // agentState with null drops a runtime session row to a channel glyph and it starts
              // calling itself a "Slack message" (round three's rejection).
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
              onArchive={(id) => toggleArchive(id, view !== "archived")}
              onSelect={(id) => {
                setSelectedId(id);
                onOpen?.({ threadId: item.row.threadId, agentSession: item.row.agentSession });
              }}
            />
          )
        }
      />
    </OpaqueSurface>
  );
}
