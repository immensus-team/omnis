// Shared state builders for the decisions that need a little thread context.
import type { Pool } from "pg";
import { getAgentsPool } from "../pool.js";

/**
 * The last few messages of a thread as plain text, newest last. `apply()`/`assemble()` build the
 * full A4 §1.2 context for a model call; a decision needs far less, and reading it here keeps the
 * two veto decisions (draft-worthiness, follow-up) from waking the whole context pipeline.
 */
export async function threadTail(
  threadId: string,
  limit = 6,
  pool: Pool | undefined = undefined,
): Promise<string> {
  const { rows } = await (pool ?? getAgentsPool()).query<{
    author_is_me: boolean;
    body: string;
  }>(
    `SELECT author_is_me, body FROM items
      WHERE thread_id = $1
      ORDER BY sent_at DESC LIMIT $2`,
    [threadId, limit],
  );
  return rows
    .reverse()
    .map((r) => `${r.author_is_me ? "Logan" : "Them"}: ${r.body}`)
    .join("\n");
}

/** The message a trigger fired for. Null when the id no longer exists — the caller then abstains. */
export async function itemState(
  itemId: string,
  pool: Pool | undefined = undefined,
): Promise<{ subject: string | null; body: string } | null> {
  const { rows } = await (pool ?? getAgentsPool()).query<{ subject: string | null; body: string }>(
    "SELECT subject, body FROM items WHERE id = $1",
    [itemId],
  );
  return rows[0] ?? null;
}

/** The person a follow-up candidate is about, plus their thread. */
export async function personState(
  personId: string,
  pool: Pool | undefined = undefined,
): Promise<{
  name: string;
  notes: string | null;
  lastContactAt: string | null;
  threadId: string | null;
} | null> {
  const { rows } = await (pool ?? getAgentsPool()).query<{
    name: string;
    notes: string | null;
    last_contact_at: Date | null;
    thread_id: string | null;
  }>(
    `SELECT p.display_name AS name, p.notes, t.last_item_at AS last_contact_at, t.id AS thread_id
       FROM persons p
       LEFT JOIN threads t ON t.id = p.primary_thread_id
      WHERE p.id = $1 AND p.merged_into IS NULL`,
    [personId],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    name: r.name,
    notes: r.notes,
    lastContactAt: r.last_contact_at?.toISOString() ?? null,
    threadId: r.thread_id,
  };
}
