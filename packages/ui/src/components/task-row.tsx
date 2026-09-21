import { ListChecks, Share2, UserCheck } from "lucide-react";
import type { ElementType } from "react";
import { cn } from "../lib/cn.js";

/** The enum behind A3's `tasks_kind_ck` (0004_tasks_approvals.sql). */
export type TaskKind = "todo" | "followup" | "delegation";
/** The enum behind A3's `tasks_state_ck`. */
export type TaskState = "open" | "in_progress" | "blocked" | "done" | "dropped";

/** A5 §3.5's `due_basis`. The column does not exist on `tasks`; the extraction loop stores the
 *  model's answer on the *source item* instead (`items.meta.task_due_basis`, see
 *  `propose_task` in packages/agents/src/tools/propose.ts), so the caller resolves it. */
export type DueBasis = "explicit" | "inferred";

/** A5 §3.5 wants a distinguishing icon per `tasks.kind`. Three kinds, three glyphs — the meaning is
 *  the kind itself, which the row exposes to assistive tech as a `role="img"` label rather than
 *  leaving a decorative svg. */
const KIND_ICON: Record<TaskKind, ElementType> = {
  todo: ListChecks,
  followup: UserCheck,
  delegation: Share2,
};

const KIND_LABEL: Record<TaskKind, string> = {
  todo: "To-do",
  followup: "Follow-up",
  delegation: "Delegated",
};

/** The right slot of a delegation row. `open`/`in_progress` are "with the agent now"; `blocked` is
 *  the one that wants a human, so it says so instead of the neutral "Running". */
const DELEGATION_STATE: Record<TaskState, string> = {
  open: "Queued",
  in_progress: "Running",
  blocked: "Needs you",
  done: "Done",
  dropped: "Dropped",
};

export interface TaskRowProps {
  id: string;
  title: string;
  kind: TaskKind;
  state: TaskState;
  dueBasis: DueBasis;
  /** Already formatted by the caller — the row formats nothing. `null` draws no due slot at all,
   *  which is what A5 §3.5's Someday view is made of. */
  dueLabel: string | null;
  /** The channel the task came from ("Gmail", "Slack"). A5 §3.5 keeps the source always visible.
   *  `null` drops the slot rather than printing "unknown source". */
  sourceLabel: string | null;
  onToggleDone: (id: string, done: boolean) => void;
  /** Clicking the source opens the message it came from. Without it the source is a label, not a
   *  control — the same rule the briefing items on Today follow. */
  onOpenSource?: () => void;
  /** Only meaningful for a delegation row that has something to open behind it. Without it the row
   *  draws the state word instead of a button that would go nowhere. */
  onOpenDelegation?: () => void;
  /** What the delegation button says. §3.5 opens the Agent Session ("Open session"); the Tasks
   *  screen also uses this slot for a delegation still waiting on approval, and a button that says
   *  "Open session" over a task that has not started running yet would be a plain lie. */
  delegationActionLabel?: string;
}

/** A5 §3.5 `TaskRow`.
 *
 *  Two deliberate choices:
 *  - the checkbox is a **native** `<input type="checkbox">`, per §3.5's accessibility note: a
 *    custom-drawn box is the usual way a screen reader ends up announcing nothing useful. Its
 *    accessible name is the task title, so the title itself carries no extra labelling.
 *  - the title is a `<span>`, not a `<label>`. Wrapping the row in a label makes a click anywhere
 *    on the title toggle the task, which fights the source link and the delegation button sitting
 *    in the same row.
 *
 *  `due_basis="inferred"` is marked with `data-due-basis` (styled as the spec's dashed underline):
 *  a due date the model guessed must not read like one the person wrote. */
export function TaskRow({
  id,
  title,
  kind,
  state,
  dueBasis,
  dueLabel,
  sourceLabel,
  onToggleDone,
  onOpenSource,
  onOpenDelegation,
  delegationActionLabel = "Open session",
}: TaskRowProps) {
  const Icon = KIND_ICON[kind];
  const done = state === "done";
  return (
    <div className={cn("task-row", `task-row--${state}`)} data-state={state} data-kind={kind}>
      <input
        type="checkbox"
        className="task-row__checkbox"
        checked={done}
        aria-label={title}
        onChange={(e) => onToggleDone(id, e.target.checked)}
      />
      <Icon size={14} className="task-row__kind" role="img" aria-label={KIND_LABEL[kind]} />
      <span className="task-row__title" data-done={done}>
        {title}
      </span>
      {dueLabel !== null && (
        <span className="task-row__due" data-due-basis={dueBasis}>
          {dueLabel}
        </span>
      )}
      {sourceLabel !== null &&
        (onOpenSource ? (
          <button type="button" className="task-row__source" onClick={onOpenSource}>
            {sourceLabel}
          </button>
        ) : (
          <span className="task-row__source">{sourceLabel}</span>
        ))}
      {kind === "delegation" &&
        (onOpenDelegation ? (
          <button type="button" className="task-row__session" onClick={onOpenDelegation}>
            {delegationActionLabel}
          </button>
        ) : (
          <span className="task-row__delegation-state">{DELEGATION_STATE[state]}</span>
        ))}
    </div>
  );
}
