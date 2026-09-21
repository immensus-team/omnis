import { query } from "@omnis/db";
import type { Pool } from "pg";

/** The Task screen's quick-add is one line and Enter is the submit key (A5 §3.5), so the ceiling is
 *  the same shape as the note composer's: long enough for a real sentence, short enough that a paste
 *  is refused rather than stored as a document. */
export const TASK_TITLE_MAX_CHARS = 500;

export interface TaskRow {
  id: string;
  title: string;
  state: string;
  created_at: string;
}

/** A5 §3.5's quick-add. Creates the undated `todo` the screen's Someday tab is for: no `due_at`, no
 *  source item, and `created_by = 'me'` — which is also what `dueBasisFor` reads as "explicit" when
 *  the row comes back through Zero.
 *
 *  No event emit. `notes.ts` emits `note.created` because the L7 routing loop is triggered by it and
 *  nothing else produces that event; no loop is armed by a human typing a task, so there is nothing
 *  here for the kernel to hear. The agents' `propose.ts` is the other writer of this table and keeps
 *  its own path.
 *
 *  Returns null for a title that is empty once trimmed or past the cap. */
export async function createTask(pool: Pool, title: string): Promise<TaskRow | null> {
  const text = title.trim();
  if (text === "" || text.length > TASK_TITLE_MAX_CHARS) return null;

  const rows = await query<TaskRow>(
    pool,
    `INSERT INTO tasks (title, kind, owner_kind, created_by)
     VALUES ($1, 'todo', 'me', 'me')
     RETURNING id, title, state, created_at`,
    [text],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("tasks insert returned no row");
  return row;
}

/** loop-r2-06/L2-04: the Tasks screen's checkbox, which until this existed flipped back and wrote
 *  nothing — `POST /tasks` was the table's only human write.
 *
 *  Two states, not the five `tasks_state_ck` allows: a checkbox has two. `in_progress`, `blocked`
 *  and `dropped` belong to the agents' own loops (`propose.ts`, the delegation path), and a screen
 *  that offered them through one square would be a state machine with a single ambiguous control.
 *
 *  `done_at` is set and cleared by the same statement, and there is no `updated_at` column to touch
 *  (0004_tasks_approvals.sql has `done_at` and neither of the other two names) — so nothing here
 *  needs a migration. Reopening a task clears the stamp rather than leaving it: "when it was
 *  finished" is not a fact about a task that is not finished.
 *
 *  Returns null when no row matches, which is the route's 404. */
export async function setTaskState(
  pool: Pool,
  id: string,
  state: "done" | "open",
): Promise<TaskRow | null> {
  const rows = await query<TaskRow>(
    pool,
    `UPDATE tasks SET state = $2, done_at = CASE WHEN $2 = 'done' THEN now() END
      WHERE id = $1
      RETURNING *`,
    [id, state],
  );
  return rows[0] ?? null;
}
