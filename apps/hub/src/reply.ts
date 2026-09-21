import { query } from "@omnis/db";
import type { Approvals } from "@omnis/kernel";
import type { Pool } from "pg";

/** loop-r2-03: the composer's ceiling. The same shape as the note and task caps — long enough for a
 *  real reply, short enough that a pasted document is refused rather than proposed as a send. */
export const REPLY_MAX_CHARS = 4000;

/** The one message a rejected reply gets. Spelled once here so the route and the test cannot come to
 *  disagree about what a person is told. */
export const REPLY_ERROR = `reply must be 1..${String(REPLY_MAX_CHARS)} characters`;

export interface ReplyDeps {
  pool: Pool;
  /** The kernel's proposer, partly applied. `propose` is the whole surface this module needs, so the
   *  dep is narrowed to it rather than the full Approvals interface. */
  approvals: Pick<Approvals, "propose">;
}

/** The thread row this route is allowed to read: who it is, and which channel a reply would leave
 *  on. A reply carries no `item_id` — it is not about one of our items, it is a new message — so the
 *  channel and the external thread id are the only two facts the approval needs to be actionable. */
export interface ReplyThreadRow {
  id: string;
  title: string | null;
  external_id: string;
  channel: string;
}

export type ReplyOutcome =
  | { ok: true; approval_id: string }
  | { ok: false; reason: "bad_request" | "not_found" };

/** loop-r2-03: the composer's one write, and it is deliberately not a send.
 *
 *  A reply typed by a person still goes out through the approval gate — the same gate A4 puts in
 *  front of every `send` — so this proposes rather than delivers, and the card that arrives is the
 *  thread's ordinary inline approval card. It carries no `item_id`: the approval is about a message
 *  that does not exist as an item yet, which is also why loop-r2-02's `foldDraft` finds nothing to
 *  pair and the card stands on its own (the body and the destination are the whole card).
 *
 *  Returns `bad_request` for a body that is empty once trimmed or past the cap, and `not_found` for
 *  a thread id that is not in `threads` — two different problems for the screen, so they are two
 *  reasons here rather than one null. */
export async function proposeReply(
  deps: ReplyDeps,
  threadId: string,
  body: string,
): Promise<ReplyOutcome> {
  const text = body.trim();
  if (text === "" || text.length > REPLY_MAX_CHARS) return { ok: false, reason: "bad_request" };

  const rows = await query<ReplyThreadRow>(
    deps.pool,
    `SELECT t.id, t.title, t.external_id, a.channel
       FROM threads t JOIN accounts a ON a.id = t.account_id
      WHERE t.id = $1`,
    [threadId],
  );
  const thread = rows[0];
  if (thread === undefined) return { ok: false, reason: "not_found" };

  const approval_id = await deps.approvals.propose({
    action: "send",
    args: {
      channel: thread.channel,
      body: text,
      thread_external_id: thread.external_id,
    },
    // The card's own header says where this goes; the description repeats it for the list views
    // that have no thread to read a title from. A thread with no title falls back to its channel's
    // own id, which is still a name a person has seen in the pane's header.
    description: `Reply in ${thread.title ?? thread.external_id}`,
    // No `allow_respond`: a reply under review is answered by editing it, and "Respond" on this card
    // would open a second field asking the agent what to do instead of the person's own message.
    config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
    risk: "normal",
    thread_id: thread.id,
  });

  return { ok: true, approval_id };
}
