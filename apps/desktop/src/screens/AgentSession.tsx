import {
  type ApprovalCardDecision,
  ApprovalStack,
  type ApprovalStackItem,
  SessionHeader,
  StatusPill,
  ToolCallBadge,
  type ToolCallState,
} from "@omnis/ui";
import type { AgentRuntimeKind } from "@omnis/ui/lib/row-meta";
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
  kind: "agent_turn" | "tool_call" | "system";
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

/** loop-r1-07/L-10: what a session with no transcript says instead of nothing at all. A working
 *  session used to open a completely blank pane — the one state where "nothing has happened yet" is
 *  the expected answer and the pane still has to say so.
 *
 *  `blocked` is read off the DB state and not off the kinso mapper: this line is about *what the
 *  session is waiting for*, and `failed` (which the pill folds into blocked, and which the brief
 *  puts with idle/done here) is a different sentence. */
function emptyLine(state: string | undefined, hasApproval: boolean): ReactNode {
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
    return <p className="agent-session-screen__empty">Blocked · nothing to decide here yet</p>;
  }
  return <p className="agent-session-screen__empty">No activity recorded for this session.</p>;
}

export function AgentSession({
  sessionThreadId,
  approvals,
  onDecide,
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
}) {
  const zero = useZeroClient();
  // Deviation from the plan's step 7 (packages/kernel/src/zero-schema.ts is the source of truth):
  // items' timestamp column is snake_case `sent_at`, not camelCase `sentAt` — Thread.tsx (Task 5)
  // already fixed this for the same reason.
  const [items] = useQuery(
    zero.query.items
      .where("thread_id", "=", sessionThreadId)
      .where("kind", "IN", ["agent_turn", "tool_call", "system"])
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
          <p className="agent-session-screen__waiting-label">Waiting on you</p>
          <ApprovalStack approvals={waiting} openThreadId={sessionThreadId} onDecide={onDecide} />
        </section>
      )}
      {typedItems.length === 0
        ? emptyLine(session?.state, waiting.length > 0)
        : typedItems.map((item) => {
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
            return (
              <p key={item.id} className="agent-session-screen__turn">
                {item.body}
              </p>
            );
          })}
    </div>
  );
}
