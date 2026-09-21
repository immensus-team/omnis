import { OpaqueSurface } from "@omnis/ui";
import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
import { useQuery } from "@rocicorp/zero/react";
import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { createNote, routeNote } from "../api/notes.js";
import { type ZeroClient, useZeroClient } from "../zero-client.js";

/** A4 §8.3 row 1: at or above this line the card is a one-tap confirmation. */
export const ROUTE_CONFIDENCE_HIGH = 0.8;

/** A5 §3.7's low-confidence state, and the copy A4 §8.3's third row produces. It is also what a
 *  routing failure reads as: the user is never shown the difference between "no match" and "the
 *  loop broke", because the action available to them is the same either way. */
export const ROUTING_NO_MATCH_COPY = "Couldn't find a routing target — pick one manually";

/** One entry of the JSON `propose_route` stores in `notes.rationale` (A4 §8.2's candidate list, the
 *  model's narrowed picks). */
export interface RouteCandidate {
  kind: "thread" | "person";
  id: string;
  confidence: number;
  why: string;
  suggested_use?: string;
}

/** What this screen reads off a `notes` row. `rationale` is a plain text column that only sometimes
 *  holds JSON, so every reader below treats it as untrusted. */
export interface NoteRouteRow {
  route_state: string;
  rationale?: string | null | undefined;
}

export interface NoteListItem extends NoteRouteRow {
  id: string;
  body: string;
  created_at: number;
  routed_to_thread_id?: string | null | undefined;
  routed_to_person_id?: string | null | undefined;
}

/** The proposal arrives as JSON in a text column, so this reads rather than trusts it: anything that
 *  is not a candidate the server would have accepted is dropped, and unreadable text is simply no
 *  candidates. That is the shape A4 §8.3 wants — a failure here has to converge on "nothing to
 *  suggest", never throw inside a render. */
export function parseRouteCandidates(rationale: string | null | undefined): RouteCandidate[] {
  if (rationale === null || rationale === undefined || rationale === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rationale);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const candidates: RouteCandidate[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const c = entry as Record<string, unknown>;
    if (c.kind !== "thread" && c.kind !== "person") continue;
    if (typeof c.id !== "string" || c.id === "") continue;
    if (typeof c.confidence !== "number" || !Number.isFinite(c.confidence)) continue;
    candidates.push({
      kind: c.kind,
      id: c.id,
      confidence: c.confidence,
      why: typeof c.why === "string" ? c.why : "",
      ...(typeof c.suggested_use === "string" ? { suggested_use: c.suggested_use } : {}),
    });
  }
  return candidates;
}

export function topRouteCandidate(note: NoteRouteRow): RouteCandidate | null {
  let best: RouteCandidate | null = null;
  for (const candidate of parseRouteCandidates(note.rationale)) {
    if (best === null || candidate.confidence > best.confidence) best = candidate;
  }
  return best;
}

/** A4 §8.3 stores a proposal only from 0.50 up, so "is there a suggestion" is the whole question —
 *  there is no confidence number for the screen to threshold.
 *
 *  The `proposed` state alone is not enough to answer it. `route_state` defaults to 'proposed' in
 *  0004_tasks_approvals.sql, so every note wears it for the two seconds the loop's debounce lasts,
 *  and keeps wearing it if the loop never runs at all — a confirmation card for a suggestion nobody
 *  made. A proposal is a state *and* a candidate. */
export function hasRoutingSuggestion(note: NoteRouteRow): boolean {
  return note.route_state === "proposed" && topRouteCandidate(note) !== null;
}

/** A5 §3.7: the confidence is words, never a percentage — "0.62" is a number the user cannot act on.
 *  A4 §8.3 draws two bands above the threshold (>= 0.80 is a 1-tap card, 0.50~0.80 is a choice) and
 *  this is the whole of how they differ on screen. */
export function routingSuggestionCopy(note: NoteRouteRow, targetLabel: string | null): string {
  const candidate = hasRoutingSuggestion(note) ? topRouteCandidate(note) : null;
  if (candidate === null || targetLabel === null) return ROUTING_NO_MATCH_COPY;
  const confidence = candidate.confidence >= ROUTE_CONFIDENCE_HIGH ? "high" : "low";
  return `Routing suggestion: share to ${targetLabel} (${confidence} confidence)`;
}

/** A5 §3.7's "Recent notes" line. An accepted note names where it went; the other two states say
 *  what is true of them rather than pointing at a target that is not there. */
export function noteRoutingLabel(note: NoteRouteRow, targetLabel: string | null): string {
  if (note.route_state === "accepted") return targetLabel === null ? "Routed" : `→ ${targetLabel}`;
  if (hasRoutingSuggestion(note)) return "Awaiting your decision";
  return "Not routed";
}

export interface RoutingPanel {
  /** The note the buttons act on. */
  noteId: string;
  /** The candidate Accept attaches it to; null means there is nothing to accept. */
  candidate: RouteCandidate | null;
  copy: string;
}

/** A5 §3.7 draws the suggestion directly under the input, so it belongs to the newest note whose
 *  decision is still open — the rest are history and stay in the list below.
 *
 *  A note with no candidate keeps the panel on the *next* note that has one instead of replacing it:
 *  a note written a second ago is still waiting for the loop's 2s debounce, and a suggestion that
 *  vanished while you typed the next note would be a suggestion you cannot accept. */
export function routingPanel(
  notes: readonly NoteListItem[],
  labelFor: (candidate: RouteCandidate) => string | null,
): RoutingPanel | null {
  const suggested = notes.find(hasRoutingSuggestion);
  if (suggested !== undefined) {
    const candidate = topRouteCandidate(suggested);
    const label = candidate === null ? null : labelFor(candidate);
    return {
      noteId: suggested.id,
      candidate: candidate !== null && label !== null ? candidate : null,
      copy: routingSuggestionCopy(suggested, label),
    };
  }

  const newest = notes[0];
  if (newest === undefined || newest.route_state === "accepted") return null;
  return { noteId: newest.id, candidate: null, copy: ROUTING_NO_MATCH_COPY };
}

/** The two things this screen can be missing, and neither is a reason to blank the list — the same
 *  shape Network.tsx uses. Zero keeps serving the rows it already synced, so the cached notes stay
 *  on screen and the banner says what is uncertain. */
export type NotesState = "error" | "loading" | "ready";

export function notesState(resultTypes: readonly ("unknown" | "complete" | "error")[]): NotesState {
  if (resultTypes.includes("error")) return "error";
  return resultTypes.includes("unknown") ? "loading" : "ready";
}

export const NOTES_BANNER: Record<NotesState, string> = {
  error: "Couldn't load notes. Check the hub logs.",
  loading: "Loading notes…",
  ready: "",
};

/** A5 §3.7's data binding: the recent notes, newest first. */
export const NOTES_LIMIT = 20;

export function Notes() {
  const zero: ZeroClient = useZeroClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [notes, notesR] = useQuery(
    zero.query.notes.orderBy("created_at", "desc").limit(NOTES_LIMIT),
  );
  // Only for names: a candidate is stored as an id (A4 §8.2), and an id is not something to show.
  const [threads, threadsR] = useQuery(zero.query.threads);
  const [persons, personsR] = useQuery(zero.query.persons);

  const state = notesState([notesR.type, threadsR.type, personsR.type]);

  const personNameById = useMemo(
    () => new Map(persons.map((p) => [p.id, p.display_name])),
    [persons],
  );
  const threadTitleById = useMemo(() => new Map(threads.map((t) => [t.id, t.title])), [threads]);

  const labelFor = useCallback(
    (candidate: RouteCandidate): string | null =>
      candidate.kind === "thread"
        ? (threadTitleById.get(candidate.id) ?? null)
        : (personNameById.get(candidate.id) ?? null),
    [threadTitleById, personNameById],
  );

  const panel = useMemo(() => routingPanel(notes, labelFor), [notes, labelFor]);

  /** Where a note that has been attached actually lives. A person is reached through the Network
   *  screen, so the label says so (A5 §3.7's "→ Network:David"); a thread is its own destination and
   *  is named by its title. */
  function targetLabelFor(note: NoteListItem): string | null {
    if (note.routed_to_person_id) {
      const name = personNameById.get(note.routed_to_person_id);
      return name === undefined ? null : `Network: ${name}`;
    }
    if (note.routed_to_thread_id) return threadTitleById.get(note.routed_to_thread_id) ?? null;
    return null;
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = body.trim();
    if (text === "" || saving) return;
    setSaving(true);
    try {
      await createNote(text);
      // A5 §3.7: the box clears so you can keep typing. Only on success — a failed save leaves the
      // words where they were, because retyping them is the one thing this screen must never ask for.
      setBody("");
      setNotice(null);
    } catch {
      setNotice("Couldn't save the note. It is still in the box.");
    } finally {
      setSaving(false);
      inputRef.current?.focus();
    }
  }

  async function decide(noteId: string, candidate: RouteCandidate | null, accept: boolean) {
    try {
      await routeNote(noteId, {
        accept,
        // A4 §8.3: the confirmed target is the candidate that was on screen. The L7 loop stores its
        // picks in `rationale` and leaves both target columns NULL, so this is the only place that
        // knows which one the human meant.
        ...(accept && candidate !== null
          ? candidate.kind === "thread"
            ? { threadId: candidate.id }
            : { personId: candidate.id }
          : {}),
      });
      setNotice(null);
    } catch {
      setNotice("Couldn't record that decision. Try again.");
    }
  }

  const banner = NOTES_BANNER[state];

  return (
    <OpaqueSurface className="notes-screen" data-state={state}>
      {banner !== "" && (
        <p
          className="notes-screen__banner"
          data-state={state}
          role={state === "error" ? "alert" : "status"}
        >
          {banner}
        </p>
      )}

      <header className="notes-screen__head">
        {/* loop-r2-08: focusable so the shell can land the focus on a screen switch — see
            App.tsx's heading-focus effect. */}
        <h1 className="notes-screen__title" tabIndex={-1}>
          Notes
        </h1>
      </header>

      {/* A5 §3.7: one line, Enter to save. A plain `<form>` because the browser's own Enter-submits
          behaviour is the interaction — there is no key handler to write for it. */}
      <form className="notes-screen__composer" onSubmit={(e) => void save(e)}>
        <input
          ref={inputRef}
          className="notes-screen__input"
          aria-label="New note"
          value={body}
          // A5 §3.7's global `n` shortcut is shell scope (the same reason `t` on Today is), so this
          // story ships the input without it.
          onChange={(e) => setBody(e.target.value)}
          placeholder="New note…"
          maxLength={2000}
        />
        <button type="submit" className="notes-screen__save" disabled={saving}>
          Save
        </button>
      </form>

      {notice !== null && (
        <p className="notes-screen__notice" role="alert">
          {notice}
        </p>
      )}

      {panel !== null && (
        <section className="notes-screen__suggestion" aria-label="Routing suggestion">
          <p className="notes-screen__suggestion-copy">{panel.copy}</p>
          {/* A5 §3.7's three decisions. "Choose another target" is follow-up scope (the picker
              reuses B27's search infrastructure), so it is drawn disabled rather than shipped as a
              button that silently does nothing. */}
          {panel.candidate !== null && (
            <div className="notes-screen__suggestion-actions">
              <button
                type="button"
                className="notes-screen__action notes-screen__action--primary"
                onClick={() => void decide(panel.noteId, panel.candidate, true)}
              >
                Accept
              </button>
              <button type="button" className="notes-screen__action" disabled>
                Choose another target
              </button>
              <button
                type="button"
                className="notes-screen__action"
                onClick={() => void decide(panel.noteId, null, false)}
              >
                Don&apos;t route
              </button>
            </div>
          )}
        </section>
      )}

      {/* A5 §3.7's "Recent notes", showing the routing result of each. */}
      <section className="notes-screen__recent" aria-label="Recent notes">
        <h2 className="notes-screen__recent-title">Recent notes</h2>
        {notes.length === 0 ? (
          <p className="notes-screen__empty">No notes yet.</p>
        ) : (
          <ul className="notes-screen__list">
            {notes.map((note) => (
              <li key={note.id} className="notes-screen__note" data-state={note.route_state}>
                <p className="notes-screen__note-body">{note.body}</p>
                <p className="notes-screen__note-route">
                  <span className="notes-screen__note-where">
                    {noteRoutingLabel(note, targetLabelFor(note))}
                  </span>
                  <span className="notes-screen__note-time">
                    {formatRelativeTime(note.created_at)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </OpaqueSurface>
  );
}
