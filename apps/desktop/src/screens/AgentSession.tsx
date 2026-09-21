import {
  type ApprovalCardDecision,
  ApprovalStack,
  type ApprovalStackItem,
  SessionHeader,
  StatusPill,
  ToolCallBadge,
  type ToolCallState,
} from "@omnis/ui";
import { type AgentRuntimeKind, RUNTIME_LABEL } from "@omnis/ui/lib/row-meta";
import { useQuery } from "@rocicorp/zero/react";
import type { ReactNode } from "react";
import { useZeroClient } from "../zero-client.js";

/** The real shape of items.tool (jsonb, only set when kind='tool_call') — 0002_core_inbox.sql:151 and
 * packages/kernel/src/zero-schema.ts's `tool: json().optional()`. The plan's `tool: string | null`
 * does not match the DB, which stores an object ({name,args,state,label,icon}) rather than a name
 * string; this interface is the corrected shape (the same kind of deviation as Thread.tsx's
 * sent_at: the plan's example code and the real zero-schema.ts disagree). */
export interface SessionToolMeta {
  name: string;
  state?: ToolCallState;
  label?: string;
  icon?: string;
  args?: unknown;
}

export interface SessionQueryItem {
  id: string;
  /** loop-r2-07: 'message' is in here too. It is the kind a session's *own* prose arrives as, and
   *  it is what the inbox row has always been reading — the row's summary is this thread's latest
   *  message, so leaving the kind out of the pane was the pane showing less than the row above it. */
  kind: "agent_turn" | "tool_call" | "system" | "message";
  tool: SessionToolMeta | null;
  body: string;
}

/** agent_sessions, the columns this screen reads. */
interface SessionRow {
  runtime_id: string;
  state: string;
  cwd?: string | null;
  summary?: string | null;
  started_at?: number | null;
  last_turn_at?: number | null;
  ended_at?: number | null;
}

/** agent_runtimes, the columns this screen reads. */
interface RuntimeRow {
  runtime: string;
  host: string;
  display: string;
}

/** master §11: send/delete/delegate/calendar_write are not callable by an agent directly — a
 *  calendar_write runs only after approval, and the result appears as a single kind='system' log
 *  line (§9 checklist). */
export function isSystemExecutionLog(item: SessionQueryItem): boolean {
  return item.kind === "system";
}

/** US-C16 (C-D7): the badge an imported transcript carries. Exact copy — it names both halves of
 *  what the row is: what it is for (reading) and where it came from (a terminal, not this app). */
export const READ_ONLY_SESSION_LABEL = "Read-only · opened in a terminal";

/** US-C16: is this thread one of the sessions the terminal import opened? `threads.external_id` is
 *  the session key (`agent:<runtime>:<host>:<purpose>`, A2-D1) and the import's whole purpose
 *  segment is `term-<source id>`, so the key is the only marker needed — no column, no second
 *  source of truth that could disagree with it. */
export function isImportedSessionKey(sessionKey: string | undefined): boolean {
  if (sessionKey === undefined) return false;
  return (sessionKey.split(":")[3] ?? "").startsWith("term-");
}

/** loop-r1-07: whether a tool call has anything to expand. The hub writes `meta.input ?? {}`, so an
 *  empty object is what a call that reported no arguments carries — a `<details>` over `{}` would be
 *  a control that opens onto nothing, and the badge alone is the honest rendering. */
export function hasToolArgs(args: unknown): boolean {
  return typeof args === "object" && args !== null && Object.keys(args).length > 0;
}

/** loop-r2-07/L2-06: why a blocked session is blocked, when omnis is not holding the question.
 *
 *  A session reads `waiting_approval` in two very different situations, and the pane used to answer
 *  both with "Blocked · nothing to decide here yet" — a sentence that is only ever true of the
 *  second one, and reads as a contradiction next to a row that says "Waiting for approval of the
 *  reply wording". The two are told apart by the approvals the shell hands this screen: the bridge
 *  links an approval to the *asking session's* thread (`onApprovalRequested`), so a linked approval
 *  is the first case and the caller renders the card instead of this note.
 *
 *  With nothing linked, the runtime is blocked somewhere omnis cannot see — its own terminal is the
 *  only place left that can answer, and naming the runtime and its host is the whole of what this
 *  screen honestly knows. `session.summary` leads when there is one: the row above the pane already
 *  says it, and a pane that opens with less than its own row is the defect this line closes.
 *
 *  `waiting_approval` is read off the DB state and not off the kinso mapper: this note is about
 *  *what the session is waiting for*, and `failed` (which the pill folds into blocked, and which the
 *  brief puts with idle/done here) is a different sentence. */
function blockedNote(session: SessionRow | undefined, runtime: RuntimeRow | undefined): ReactNode {
  if (session?.state !== "waiting_approval") return null;
  const said = session.summary?.trim() ?? "";
  const head = said === "" ? "Blocked ·" : `Blocked · ${/[.!?]$/.test(said) ? said : `${said}.`}`;
  // The runtime row is a second read, and a session whose runtime has not synced yet draws its
  // header without one (above). This line still has to name *something*: the sentence is about
  // where the question went, and "somewhere omnis cannot see" is the same fact either way.
  const asker =
    runtime === undefined ? "The runtime" : RUNTIME_LABEL[runtime.runtime as AgentRuntimeKind];
  const where = runtime === undefined ? "" : ` on ${runtime.host}`;
  return (
    <p className="agent-session-screen__blocked" role="note">
      {`${head} No approval is waiting in omnis. ${asker} may be asking in its own terminal${where}.`}
    </p>
  );
}

/** loop-r1-07/L-10: what a session with no transcript says instead of nothing at all. A working
 *  session used to open a completely blank pane — the one state where "nothing has happened yet" is
 *  the expected answer and the pane still has to say so.
 *
 *  `blocked` is the note above, already built (see `blockedNote`); it arrives here as an element so
 *  that the same sentence can be drawn under a transcript that *did* record something. */
function emptyLine(state: string | undefined, hasApproval: boolean, blocked: ReactNode): ReactNode {
  if (state === "starting" || state === "running") {
    return (
      <p className="agent-session-screen__empty">
        <span className="agent-session-screen__empty-dot" aria-hidden="true" />
        Working · no output yet
      </p>
    );
  }
  if (state === "waiting_approval") {
    // With a card above it this line would contradict what is already on screen — the approval *is*
    // what it is waiting for.
    if (hasApproval) return null;
    return blocked;
  }
  return <p className="agent-session-screen__empty">No activity recorded for this session.</p>;
}

/** One agent session — its header, its transcript and whatever it is waiting on.
 *
 *  **A decision here does not unblock the session, and this screen does not pretend it does.** The
 *  state is the hub's: after a decision the bridge's `settleState` recomputes it from the runtime's
 *  own report (`turn.completed`, an approval still open, …) and it arrives through Zero like every
 *  other row. Nothing in the desktop writes an agent session's state — a pane that flipped the pill
 *  itself would be claiming a runtime resumed work it was never told about, and the row behind it
 *  would disagree. */
export function AgentSession({
  sessionThreadId,
  approvals,
  onDecide,
  onOpenThread,
}: {
  sessionThreadId: string;
  /** Every pending approval the shell holds. This screen narrows to its own thread — §c.5's rule
   *  for the conversation applies here too: another thread's approval under this session's title is
   *  a card about work that is not the thing on screen. */
  approvals?: ApprovalStackItem[];
  onDecide?: (
    id: string,
    decision: ApprovalCardDecision,
    decidedArgs?: Record<string, unknown>,
  ) => void;
  /** loop-r2-06/L2-24: the same "Open {title}" the queue's stack offers, so the card behaves the
   *  same wherever it is drawn. */
  onOpenThread?: (threadId: string) => void;
}) {
  const zero = useZeroClient();
  // Deviation from the plan's step 7 (packages/kernel/src/zero-schema.ts is the source of truth):
  // items' timestamp column is snake_case `sent_at`, not camelCase `sentAt` — Thread.tsx (Task 5)
  // already fixed this for the same reason.
  // loop-r2-07: 'message' joined the list. The query used to take only the three transcript kinds,
  // and a session's own line — the one the row above the pane summarises it with — is a 'message'
  // item, so the pane drew strictly less than its own row. The same three kinds still carry their
  // own rendering below; a message is a turn.
  const [items] = useQuery(
    zero.query.items
      .where("thread_id", "=", sessionThreadId)
      .where("kind", "IN", ["agent_turn", "tool_call", "system", "message"])
      .orderBy("sent_at", "asc"),
  );
  // The four reads below are unconditional, and the two that need an id the first read supplies
  // query the empty string instead of being skipped — the number of hooks cannot depend on what
  // came back, which is the same rule App.tsx follows for `open?.threadId`.
  const [sessionRows] = useQuery(
    zero.query.agent_sessions.where("thread_id", "=", sessionThreadId),
  );
  const session = (sessionRows as unknown as SessionRow[])[0];
  const [runtimeRows] = useQuery(
    zero.query.agent_runtimes.where("id", "=", session?.runtime_id ?? ""),
  );
  const runtime = (runtimeRows as unknown as RuntimeRow[])[0];
  const [threadRows] = useQuery(zero.query.threads.where("id", "=", sessionThreadId));
  const thread = (threadRows as unknown as { title?: string | null; external_id?: string }[])[0];
  const title = thread?.title ?? null;
  const readOnly = isImportedSessionKey(thread?.external_id);

  const typedItems = items as unknown as SessionQueryItem[];
  const waiting = (approvals ?? []).filter((a) => a.thread_id === sessionThreadId);
  // loop-r2-07: a linked approval *is* what the session is waiting for, and the card below says it
  // in the words of the action itself — so the note is drawn only when nothing is linked.
  const blocked = waiting.length === 0 ? blockedNote(session, runtime) : null;
  // The header is the session's own facts, so it needs the session row and the runtime that ran it.
  // A thread whose session has not synced yet draws its timeline without a header rather than a
  // header full of placeholders.
  const header =
    session !== undefined && runtime !== undefined ? (
      <SessionHeader
        title={title ?? "Agent session"}
        state={session.state}
        runtime={runtime.runtime as AgentRuntimeKind}
        host={runtime.host}
        cwd={session.cwd ?? null}
        startedAt={session.started_at ?? null}
        lastTurnAt={session.last_turn_at ?? null}
        endedAt={session.ended_at ?? null}
      />
    ) : null;

  return (
    <div className="agent-session-screen">
      {header}
      {/* US-C16 (C-D7): an imported transcript says so, right under the header that names it. This
          screen draws no composer for any session — a live one has nothing to send either until the
          story that owns sending lands — so the badge is the whole of the read-only surface, and
          `turn.start` is refused at the hub for the session itself rather than only here. */}
      {readOnly && (
        <p className="agent-session-screen__readonly">
          <StatusPill tone="neutral" label={READ_ONLY_SESSION_LABEL} />
        </p>
      )}
      {/* loop-r1-07: the queue used to sit *above* this screen (App.tsx), which is what an agent
          session with a pending approval looked like: a card, and then a "Blocked" session that
          never said what it was blocked on. It is the same stack, in the place the thread screen
          puts its own — under the title of the thing it is about. */}
      {waiting.length > 0 && onDecide !== undefined && (
        <section className="agent-session-screen__waiting">
          {/* loop-r2-07: "Waiting on you" named the section but not the connection — the session is
              blocked *on this approval*, and the label now says which of the two things it means. */}
          <p className="agent-session-screen__waiting-label">Waiting for your approval</p>
          <ApprovalStack
            approvals={waiting}
            openThreadId={sessionThreadId}
            onDecide={onDecide}
            // Every approval in this stack is this thread's own (the filter above), so the
            // destination is the title the header already read — no lookup table to thread in.
            destinationFor={() => title}
            {...(onOpenThread ? { onOpenThread } : {})}
          />
        </section>
      )}
      {/* loop-r2-07: the note comes *after* the transcript, never before it. "✓ Turn completed" is
          how the pane's own record ends, and the reason the session is still blocked is the answer
          to it — drawing the note above (where the old empty-state line lived) would put the
          conclusion before the evidence and leave the transcript as the last word again. */}
      {typedItems.length === 0 ? (
        emptyLine(session?.state, waiting.length > 0, blocked)
      ) : (
        <>
          {typedItems.map((item) => {
            if (isSystemExecutionLog(item)) {
              return (
                <p key={item.id} className="agent-session-screen__system-log">
                  {item.body}
                </p>
              );
            }
            if (item.kind === "tool_call" && item.tool) {
              const state: ToolCallState = item.tool.state ?? "loading";
              // exactOptionalPropertyTypes (Global Constraints): `resultSummary?: string` means
              // "may be omitted", not "may be undefined", so `resultSummary={item.body || undefined}`
              // is a type error (the same family as the useKeymap/US-A29 deviation) — the prop is
              // spread only when there is a value for it.
              const badge = {
                tool: item.tool.name,
                state,
                ...(item.body ? { resultSummary: item.body } : {}),
              };
              if (!hasToolArgs(item.tool.args)) {
                return <ToolCallBadge key={item.id} {...badge} />;
              }
              // A native <details>: the disclosure, the keyboard (Enter/Space on the summary) and
              // the accessibility tree all come from the element, and its height opens instantly —
              // the only animation on this screen is the working dot above.
              return (
                <details key={item.id} className="agent-session-screen__tool">
                  <summary>
                    <ToolCallBadge {...badge} />
                  </summary>
                  <pre>{JSON.stringify(item.tool.args, null, 2)}</pre>
                </details>
              );
            }
            // loop-r2-07: everything else is a turn — 'agent_turn' and now 'message' both arrive
            // here, whatever the session said in its own words.
            return (
              <p key={item.id} className="agent-session-screen__turn">
                {item.body}
              </p>
            );
          })}
          {blocked}
        </>
      )}
    </div>
  );
}
