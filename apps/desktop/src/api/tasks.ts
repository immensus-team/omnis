// A5 §3.5's quick-add write. Hub HTTP (contract §5) — Zero is read-only, and the new task comes
// back to the screen through it rather than from this response.
//
// OMNIS_HUB_HTTP_URL is on the interface contract §9 env list; when it is unset at build time the
// local default is used (the same line notes.ts and approvals.ts carry).
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

/** The row `POST /tasks` returns, which is the row the database stored. */
export interface TaskRecord {
  id: string;
  title: string;
  state: string;
  created_at: string;
}

/** A5 §3.5's one-line input. The title is sent as typed and trimmed by the hub; a rejected title
 *  throws, which is what keeps the caller from clearing a box whose words were never stored. */
export async function createTask(title: string): Promise<TaskRecord> {
  const res = await fetch(`${HUB_HTTP_URL}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`task add failed: HTTP ${res.status}`);
  return res.json();
}

/** loop-r2-06/L2-04: the checkbox's write. Two states and no third: the hub owns `done_at`, and a
 *  caller that could also send `in_progress` would be reaching into the agents' own state machine
 *  from a square. A refusal throws, which is what makes the screen put the box back. */
export async function setTaskDone(id: string, done: boolean): Promise<TaskRecord> {
  const res = await fetch(`${HUB_HTTP_URL}/tasks/${id}/state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: done ? "done" : "open" }),
  });
  if (!res.ok) throw new Error(`task update failed: HTTP ${res.status}`);
  return res.json();
}
