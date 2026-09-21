import { query } from "@omnis/db";
import type { Events } from "@omnis/kernel";
import type { Pool } from "pg";

/** A5 §3.7's input is one line and Enter is the submit key; this is the ceiling that keeps a paste
 *  from turning the list into a document. */
export const NOTE_MAX_CHARS = 2000;

export interface NoteRow {
  id: string;
  body: string;
  route_state: string;
  created_at: string;
}

/** A5 §3.7's note entry. Saving is local-first: the row is written and returned before the L7 loop
 *  has had a chance to say anything about it, and the screen shows the suggestion when it arrives.
 *
 *  The emit is the important half. `note.created` is the note-routing loop's trigger (packages/
 *  agents/src/loops/note-route.ts, A4 §8.1) and nothing else in this build produces that event, so
 *  without it a note is written and never routed. Ephemeral, not durable: the kind is absent from
 *  the kernel's DURABLE_CHANNEL map, and the loop runner subscribes in this same process.
 *
 *  Returns null for a body that is empty once trimmed or past the cap. */
export async function createNote(
  pool: Pool,
  events: Events,
  body: string,
): Promise<NoteRow | null> {
  const text = body.trim();
  if (text === "" || text.length > NOTE_MAX_CHARS) return null;

  const rows = await query<NoteRow>(
    pool,
    "INSERT INTO notes (body) VALUES ($1) RETURNING id, body, route_state, created_at",
    [text],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("notes insert returned no row");

  try {
    await events.emit("ephemeral", "note.created", { note_id: row.id, body: row.body });
  } catch {
    // The note is already committed; a loop that could not be armed costs a suggestion, not the note.
  }
  return row;
}

/** Delta §7's route body: `{ accept, thread_id?, person_id? }`. The target is the candidate the
 *  human confirmed — the L7 loop stores its proposal as JSON in `notes.rationale` and leaves both
 *  target columns NULL (packages/agents/src/tools/propose.ts), so the client is the one that knows
 *  which candidate was on screen when Accept was pressed. */
export interface NoteRouteDecision {
  accept: boolean;
  thread_id?: string;
  person_id?: string;
}

export type RouteOutcome =
  | { ok: true; route_state: string }
  | { ok: false; reason: "bad_request" | "not_found" | "not_proposed" };

/** A4 §8.3: attaching a note is never automatic. This is the one write a human makes against a
 *  proposal, and it is reversible by deciding again on a note the loop has re-proposed.
 *
 *  `accept` requires exactly one target: an "accepted" note with neither column set is a note the
 *  assembler will never find, which is the failure A4 §8.3's confirmation card exists to prevent
 *  (the `none` branch is how a note is left unattached on purpose). */
export async function decideNoteRouting(
  pool: Pool,
  noteId: string,
  decision: NoteRouteDecision,
): Promise<RouteOutcome> {
  if (decision.accept) {
    const targets = [decision.thread_id ?? null, decision.person_id ?? null].filter(
      (t) => t !== null,
    );
    if (targets.length !== 1) return { ok: false, reason: "bad_request" };
  }

  const rows = decision.accept
    ? await query<{ route_state: string }>(
        pool,
        `UPDATE notes SET route_state = 'accepted', routed_to_thread_id = $2, routed_to_person_id = $3
          WHERE id = $1 AND route_state = 'proposed'
        RETURNING route_state`,
        [noteId, decision.thread_id ?? null, decision.person_id ?? null],
      )
    : await query<{ route_state: string }>(
        pool,
        `UPDATE notes SET route_state = 'none', routed_to_thread_id = NULL, routed_to_person_id = NULL
          WHERE id = $1 AND route_state = 'proposed'
        RETURNING route_state`,
        [noteId],
      );

  const row = rows[0];
  if (row !== undefined) return { ok: true, route_state: row.route_state };

  // Nothing was updated: either there is no such note, or it is not a pending proposal. One more
  // read tells the two apart, because 404 and 409 are different problems for the screen.
  const existing = await query<{ route_state: string }>(
    pool,
    "SELECT route_state FROM notes WHERE id = $1",
    [noteId],
  );
  return existing[0] === undefined
    ? { ok: false, reason: "not_found" }
    : { ok: false, reason: "not_proposed" };
}
