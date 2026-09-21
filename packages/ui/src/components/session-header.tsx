import { formatRelativeTime } from "../lib/relative-time.js";
import { type AgentRuntimeKind, RUNTIME_LABEL, agentSessionKinsoState } from "../lib/row-meta.js";
import { RowAvatarView } from "./inbox-row.js";
import { type KeyValueRow, KeyValueTable } from "./key-value-table.js";
import { AgentStatusPill } from "./status-pill.js";

/** loop-r1-07/L-10: what an agent session's pane was missing — who is running, where, since when,
 *  and what it is waiting on. The herdr/Linear agent-view header, at this product's density.
 *
 *  Not glass. A session is the pane's *content* (v3 §e guard 4: the canvas, the message bodies and
 *  the cards stay opaque, glass is chrome), so this is a plain block on the same paper as the
 *  timeline under it.
 *
 *  The state pill is `AgentStatusPill` with the row's own mapper, which is the whole point: the
 *  inbox row and this header are two views of one fact, and a second mapping here is how they would
 *  ever come to disagree (UX-15). `failed` is layered on top the way status-pill.tsx describes —
 *  the row badge has no failed state to read, the DB does, and this header is close enough to the
 *  session to say which of the two "needs a look" states it is in. */
export interface SessionHeaderProps {
  /** threads.title of the session's own thread. */
  title: string;
  /** agent_sessions.state, as the DB carries it (starting/idle/running/waiting_approval/ended/
   *  failed) — the mapper above is what turns it into a kinso state. */
  state: string;
  /** agent_runtimes.runtime. */
  runtime: AgentRuntimeKind;
  /** agent_runtimes.host — the machine the runtime is on, not this app's. */
  host: string;
  /** agent_sessions.cwd. */
  cwd?: string | null;
  /** epochs ms, all three. */
  startedAt?: number | null;
  lastTurnAt?: number | null;
  endedAt?: number | null;
}

export function SessionHeader({
  title,
  state,
  runtime,
  host,
  cwd,
  startedAt,
  lastTurnAt,
  endedAt,
}: SessionHeaderProps) {
  // Only the rows that have a value. A row with nothing to say is dropped, not printed as "—":
  // KeyValueTable's own contract, and the reason this is a list built here rather than a record
  // handed over whole.
  //
  // There is deliberately no cost or token row (UX-13). Zero carries neither for a session — the
  // only figure the hub has is the runtime's own reported turn cost, and a `$0.00` under a session
  // that spent real money is worse than the row being absent.
  const rows: KeyValueRow[] = [{ label: "Runtime", value: `${RUNTIME_LABEL[runtime]} on ${host}` }];
  if (cwd) {
    rows.push({
      label: "Directory",
      value: (
        // `<bdi>` because the span is `direction: rtl` (app.css: the ellipsis has to fall on the
        // left, where a path is cut). Without the isolation the path is an LTR run inside an RTL
        // paragraph, and the leading "/" — a neutral between the paragraph start and a strong LTR
        // character — is reordered to the *visual end*: `/Users/…-r1` renders as `Users/…-r1/`. The
        // element makes the path its own LTR run, so the slash stays where the path puts it.
        <span className="session-header__cwd" title={cwd}>
          <bdi>{cwd}</bdi>
        </span>
      ),
    });
  }
  if (startedAt != null) {
    rows.push({ label: "Started", value: formatRelativeTime(startedAt), numeric: true });
  }
  if (lastTurnAt != null) {
    rows.push({ label: "Last turn", value: formatRelativeTime(lastTurnAt), numeric: true });
  }
  if (endedAt != null) {
    rows.push({ label: "Ended", value: formatRelativeTime(endedAt), numeric: true });
  }

  return (
    <header className="session-header">
      <div className="session-header__line">
        {/* The same runtime tile an inbox row draws, at 32px instead of 40 — reused rather than
            re-drawn, so a runtime that gains a brand mark gains it in both places at once. */}
        <span className="session-header__avatar">
          <RowAvatarView avatar={{ kind: "runtime", runtime }} />
        </span>
        <h2 className="session-header__title">{title}</h2>
        <AgentStatusPill state={state === "failed" ? "failed" : agentSessionKinsoState(state)} />
      </div>
      <KeyValueTable rows={rows} className="session-header__meta" />
    </header>
  );
}
