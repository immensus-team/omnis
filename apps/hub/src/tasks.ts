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
