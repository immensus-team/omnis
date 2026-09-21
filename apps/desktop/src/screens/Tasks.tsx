import { OpaqueSurface, SegmentedControl, type TaskKind, TaskRow, type TaskState } from "@omnis/ui";
import { type ApprovalCardInterrupt, ApprovalCardView } from "@omnis/ui/components/approval-card";
import { CHANNEL_LABEL } from "@omnis/ui/lib/row-meta";
import type { UiChannel } from "@omnis/ui/types";
import { useQuery } from "@rocicorp/zero/react";
import { type FormEvent, useMemo, useState } from "react";
import { decideApproval } from "../api/approvals.js";
import { type ZeroClient, useZeroClient } from "../zero-client.js";

/** A5 §3.5's four tabs, in the order the mock draws them. */
export const TASKS_VIEWS = ["today", "week", "someday", "delegated"] as const;
export type TasksView = (typeof TASKS_VIEWS)[number];

export const VIEW_LABEL: Record<TasksView, string> = {
  today: "Today",
  week: "This week",
  someday: "Someday",
  delegated: "Delegated",
};

/** A5 §8 names two of these; the other two follow the same shape rather than inventing a different
 *  register. Each one says what is empty about *this* tab — "No tasks" on four tabs tells the reader
 *  nothing about which one they are looking at. */
export const VIEW_EMPTY: Record<TasksView, string> = {
  today: "Nothing due today",
  week: "Nothing due this week",
  someday: "Nothing without a date",
  delegated: "No delegated tasks",
};

/** The plan's `TaskViewRow`: the four fields `filterTasksByView` reasons about, so the filter is
 *  testable without a database and without Zero's row type. */
export interface TaskViewRow {
  id: string;
  ownerKind: "me" | "agent";
  dueAt: number | null;
  state: string;
}

/** A5 §3.5: Today/This week/Someday key off `due_at`; Delegated is `owner_kind='agent'` only,
 *  regardless of due date. Tasks in a terminal state leave every tab — A3 has both `done` and
 *  `dropped`, and a task the person gave up on has to leave the list exactly the way a finished one
 *  does, or it sits on Today forever. */
export function filterTasksByView<T extends TaskViewRow>(
  tasks: T[],
  view: TasksView,
  now: Date,
): T[] {
  const open = tasks.filter((t) => t.state !== "done" && t.state !== "dropped");
  if (view === "delegated") return open.filter((t) => t.ownerKind === "agent");
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);
  if (view === "today")
    return open.filter((t) => t.dueAt !== null && t.dueAt <= todayEnd.getTime());
  if (view === "week") {
    // Strictly `>` today's end: a task due at 23:00 tonight belongs to Today, and listing it under
    // both tabs is how a task gets counted twice in one glance.
    return open.filter(
      (t) => t.dueAt !== null && t.dueAt > todayEnd.getTime() && t.dueAt <= weekEnd.getTime(),
    );
  }
  return open.filter((t) => t.dueAt === null || t.dueAt > weekEnd.getTime());
}

/** `tasks` has no `due_basis` column, so the plan infers it from `created_by`. That inference is a
 *  guess — and the real answer is not lost: `propose_task` (packages/agents/src/tools/propose.ts)
 *  stores the model's own `due_basis` on the *source item* as `items.meta.task_due_basis`. When the
 *  screen has that row, it wins; `created_by` is only the fallback for a task whose source is gone
 *  or was never extracted. */
export function dueBasisFor(
  createdBy: string,
  itemDueBasis?: string | null,
): "explicit" | "inferred" {
  if (itemDueBasis === "stated") return "explicit";
  if (itemDueBasis === "inferred") return "inferred";
  return createdBy === "agent" ? "inferred" : "explicit";
}

/** `en-US` for the month name only, then re-assembled day-first: `en-GB` renders September as
 *  "Sept", and the repo's own relative formatter prints "4 Aug" — three letters, day first. */
const DATE_PARTS = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

function shortDate(d: Date): string {
  const parts = DATE_PARTS.formatToParts(d);
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  return `${day} ${month}`.trim();
}

/** A5 §3.5's due column. A date in the past is the one thing on this screen that needs attention,
 *  so it says so instead of printing a date the reader has to compare against a clock. */
export function dueLabelFor(dueAt: number | null, now: Date): string | null {
  if (dueAt === null) return null;
  const due = new Date(dueAt);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Counted in calendar days, not in elapsed hours: a task due at 09:00 is still "due today" at
  // noon, and `Math.round` keeps the count right across a DST boundary (those days are 23 or 25
  // hours long, and a truncating divide would call them two days apart).
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  if (days < 0) return "Overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due ${shortDate(due)}`;
}

/** The two things this screen can be missing, and neither is a reason to blank the list. `offline`
 *  is not one of them: Zero keeps serving the rows it already synced, and a banner that shares a
 *  line with "Loading…" would have to decide which of the two it is — the answer is that the rows
 *  on screen are the truth either way. */
export type TasksState = "error" | "loading" | "ready";

export function tasksState(resultTypes: readonly ("unknown" | "complete" | "error")[]): TasksState {
  if (resultTypes.includes("error")) return "error";
  return resultTypes.includes("unknown") ? "loading" : "ready";
}

export const TASKS_BANNER: Record<TasksState, string> = {
  error: "Couldn't load tasks. Check the hub logs.",
  loading: "Loading tasks…",
  ready: "",
};

/** Sent as the `IN` list when no task has a source item. A real uuid that matches nothing: Zero's
 *  query builder takes an array, and the number of hooks cannot be conditional, so the empty case
 *  still has to be a valid query. */
const NO_SOURCE_IDS = ["00000000-0000-0000-0000-000000000000"];

export interface TasksProps {
  /** Fixed for the life of the mount, like Today's. Injectable so the view boundaries are testable. */
  now?: Date;
  /** A task's source message → its Thread. Without it the source is a label, not a control. */
  onOpenSource?: (itemId: string) => void;
  /** A delegated task's Agent Session (tasks.delegated_session_id). */
  onOpenDelegation?: (sessionId: string) => void;
  /** A5 §3.5: the checkbox is an optimistic `state: 'done'`. The hub has no tasks write route yet
   *  (the plan's open question, shared with the agents plan), so today the shell passes nothing and
   *  the checkbox reflects the row it was given. */
  onToggleDone?: (taskId: string, done: boolean) => void;
}

export function Tasks({ now: nowProp, onOpenSource, onOpenDelegation, onToggleDone }: TasksProps) {
  const zero: ZeroClient = useZeroClient();
  const [view, setView] = useState<TasksView>("today");
  const [quickAdd, setQuickAdd] = useState("");
  /** Which delegation's approval card is open in place. One at a time — an approval card is a large
   *  object, and two of them stacked is not a list any more. */
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);

  // Ordered by `due_at`, the same key the three date tabs are defined by. A5 §3.5's example binding
  // is a bare `zero.query('tasks')` with no order, and an unordered query over a table whose key is a
  // random uuid is not merely "unsorted" — it is a different order per run, which is what the shot
  // script showed: two runs of the same fixture drew Today's rows in two different sequences.
  //
  // `due_at` rather than `created_at` because it is the only key this screen already reasons about,
  // and ordering by the tabs' own axis is the least inventive choice available. Undated tasks (the
  // Someday tab) have no such key and keep whatever order the server returns — a bucket defined by
  // the absence of a value has nothing to sort on, and inventing a second key for it would be a
  // product decision this story was not given.
  const [tasks, tasksR] = useQuery(zero.query.tasks.orderBy("due_at", "asc"));
  const [approvals, approvalsR] = useQuery(
    zero.query.pending_approvals.where("state", "=", "pending"),
  );
  const [accounts, accountsR] = useQuery(zero.query.accounts);

  // The source item carries the two facts the task row cannot: the channel it came from and the
  // model's own due_basis. Read by id rather than by a window — the task list is the small side of
  // this join, so the ids are the cheap argument, and unlike a "newest 200 items" window this stays
  // correct for a task extracted last month.
  const sourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) if (typeof t.source_item_id === "string") ids.add(t.source_item_id);
    return ids.size === 0 ? NO_SOURCE_IDS : [...ids];
  }, [tasks]);
  const [sourceItems, itemsR] = useQuery(zero.query.items.where("id", "IN", sourceIds));

  const channelByAccount = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.channel])),
    [accounts],
  );
  const sourceItemById = useMemo(() => new Map(sourceItems.map((i) => [i.id, i])), [sourceItems]);

  const state = tasksState([tasksR.type, approvalsR.type, accountsR.type, itemsR.type]);
  const banner = TASKS_BANNER[state];

  const visible = useMemo(
    () =>
      filterTasksByView(
        tasks.map((t) => ({
          id: t.id,
          ownerKind: t.owner_kind === "agent" ? ("agent" as const) : ("me" as const),
          dueAt: t.due_at ?? null,
          state: t.state,
        })),
        view,
        now,
      ),
    [tasks, view, now],
  );
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  /** A delegation's card lives on the approval, and the approval points back at the task
   *  (`pending_approvals.task_id`) — that is the only link between them, since the session does not
   *  exist until someone accepts. */
  const approvalByTaskId = useMemo(() => {
    const map = new Map<string, (typeof approvals)[number]>();
    for (const a of approvals) {
      if (a.action === "delegate" && typeof a.task_id === "string") map.set(a.task_id, a);
    }
    return map;
  }, [approvals]);

  const sourceLabelFor = (taskId: string): string | null => {
    const task = taskById.get(taskId);
    const item = task?.source_item_id ? sourceItemById.get(task.source_item_id) : undefined;
    const channel = item ? channelByAccount.get(item.account_id) : undefined;
    if (channel === undefined) return null;
    // An account whose channel is not in the UI's enum is a row this build does not know how to
    // draw; it gets no source label rather than the raw column value.
    return (CHANNEL_LABEL as Record<string, string | undefined>)[channel as UiChannel] ?? null;
  };

  const sourceDueBasisFor = (taskId: string): string | null => {
    const task = taskById.get(taskId);
    const item = task?.source_item_id ? sourceItemById.get(task.source_item_id) : undefined;
    const meta = item?.meta as { task_due_basis?: unknown } | undefined;
    return typeof meta?.task_due_basis === "string" ? meta.task_due_basis : null;
  };

  function onSubmitQuickAdd(e: FormEvent) {
    e.preventDefault();
    // The field is the deliverable the plan asks for ("title only, the rest later"); the write route
    // behind it is the plan's open question, shared with the agents plan. Clearing without storing
    // is the honest state of that: nothing has been created, so nothing is claimed to have been.
    setQuickAdd("");
  }

  return (
    <OpaqueSurface className="tasks-screen" data-state={state} data-view={view}>
      {banner !== "" && (
        <p
          className="tasks-screen__banner"
          data-state={state}
          role={state === "error" ? "alert" : "status"}
        >
          {banner}
        </p>
      )}

      <header className="tasks-screen__head">
        <h1 className="tasks-screen__title">Tasks</h1>
        <SegmentedControl
          className="tasks-screen__views"
          label="Task views"
          value={view}
          onChange={setView}
          options={TASKS_VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v] }))}
        />
      </header>

      <form className="tasks-screen__quick-add" onSubmit={onSubmitQuickAdd}>
        <input
          className="tasks-screen__quick-input"
          aria-label="Quick add task"
          placeholder="New task…"
          value={quickAdd}
          onChange={(e) => setQuickAdd(e.target.value)}
        />
      </form>

      {visible.length === 0 ? (
        <p className="tasks-screen__empty">{VIEW_EMPTY[view]}</p>
      ) : (
        <ul className="tasks-screen__list">
          {visible.map((row) => {
            const task = taskById.get(row.id);
            if (!task) return null;
            const approval = approvalByTaskId.get(task.id);
            const sessionId = task.delegated_session_id;
            const expanded = expandedTaskId === task.id;
            // Three different things can sit behind a delegation row, and they are not
            // interchangeable: a card to decide, a session to open, or neither (the state word).
            const delegation = approval
              ? { label: "Needs approval", onClick: () => setExpandedTaskId(task.id) }
              : sessionId && onOpenDelegation
                ? { label: "Open session", onClick: () => onOpenDelegation(sessionId) }
                : null;
            return (
              <li key={task.id} className="tasks-screen__item">
                <TaskRow
                  id={task.id}
                  title={task.title}
                  kind={task.kind as TaskKind}
                  state={task.state as TaskState}
                  dueBasis={dueBasisFor(task.created_by, sourceDueBasisFor(task.id))}
                  dueLabel={dueLabelFor(row.dueAt, now)}
                  sourceLabel={sourceLabelFor(task.id)}
                  onToggleDone={(id, done) => onToggleDone?.(id, done)}
                  {...(task.source_item_id && onOpenSource
                    ? { onOpenSource: () => onOpenSource(task.source_item_id as string) }
                    : {})}
                  {...(delegation
                    ? {
                        onOpenDelegation: delegation.onClick,
                        delegationActionLabel: delegation.label,
                      }
                    : {})}
                />
                {/* A5 §3.5's inline delegation approval — the plan's YAGNI note is explicit that
                    this reuses ApprovalCardView rather than drawing a card of its own. */}
                {approval && expanded && (
                  <ApprovalCardView
                    className="tasks-screen__approval"
                    interrupt={{
                      action: approval.action as ApprovalCardInterrupt["action"],
                      description: approval.description,
                      args: (approval.args ?? {}) as Record<string, unknown>,
                      config: approval.config as ApprovalCardInterrupt["config"],
                    }}
                    onDecide={(decision, decidedArgs) => {
                      setExpandedTaskId(null);
                      decideApproval(approval.id, decision, decidedArgs).catch((e: unknown) => {
                        console.error("approval decide failed", e);
                      });
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </OpaqueSurface>
  );
}
