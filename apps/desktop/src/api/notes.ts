// Writes all go through hub HTTP (contract §5) — Zero is read-only, and so are notes.
//
// OMNIS_HUB_HTTP_URL is on the interface contract §9 env list; when it is unset at build time the
// local default is used (the same line search.ts and approvals.ts carry).
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

/** The row `POST /notes` returns, which is the row the database stored. */
export interface NoteRecord {
  id: string;
  body: string;
  route_state: string;
  created_at: string;
}

/** A5 §3.7's one-line input. The hub writes the row and arms the L7 loop with it; the screen gets
 *  the note back so it can clear the box with something to show for it. */
export async function createNote(body: string): Promise<NoteRecord> {
  const res = await fetch(`${HUB_HTTP_URL}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`note save failed: HTTP ${res.status}`);
  return res.json();
}

/** Delta §7: `{ accept, thread_id?, person_id? }`. `accept` is the human settling the L7 proposal —
 *  never the loop — and carries the candidate that was on screen when the button was pressed. */
export interface NoteRoutingDecision {
  accept: boolean;
  /** Exactly one of the two is set when accepting: A4 §8.3 attaches a note or does not accept it. */
  threadId?: string;
  personId?: string;
}

export async function routeNote(
  id: string,
  decision: NoteRoutingDecision,
): Promise<{ id: string; route_state: string }> {
  const body: Record<string, unknown> = { accept: decision.accept };
  if (decision.threadId !== undefined) body.thread_id = decision.threadId;
  if (decision.personId !== undefined) body.person_id = decision.personId;

  const res = await fetch(`${HUB_HTTP_URL}/notes/${id}/route`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`note routing decide failed: HTTP ${res.status}`);
  return res.json();
}
