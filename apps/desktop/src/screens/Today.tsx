import { OpaqueSurface } from "@omnis/ui";
import { type ApprovalCardInterrupt, ApprovalCardView } from "@omnis/ui/components/approval-card";
import { DigestCard } from "@omnis/ui/components/digest-card";
import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
import { useQuery } from "@rocicorp/zero/react";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { decideApproval } from "../api/approvals.js";
import { type ZeroClient, useZeroClient } from "../zero-client.js";

/** A5 §3.4: greeting text, rendered as an <h1> so a screen reader announces the page's gist
 *  immediately.
 *
 *  `now` is a parameter rather than a `new Date()` inside, for two reasons: the hour has to be
 *  reachable from a test, and "Good morning" at 15:00 is simply wrong on a screen whose name is
 *  Today — the plan's fixed "Good morning" was the one place the copy and the clock disagreed. */
export function greetingLine(
  name: string,
  pendingCount: number,
  approvalCount: number,
  now: Date = new Date(),
): string {
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return `Good ${part}, ${name}. ${pendingCount} items to handle today, ${approvalCount} approvals pending.`;
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export type ScreenState = "error" | "offline" | "loading" | "empty" | "ready";

/** US-B28's four states. Zero's query result type is 'unknown' | 'complete' | 'error'
 *  (@rocicorp/zero 1.9.0 `ResultType`), and while offline a query never reaches 'complete' — that
 *  is why offline comes before loading. error carries the most specific information, so it comes
 *  first. The return value is a *word*, never a reason to blank the body: offline and error keep
 *  rendering the rows Zero has already synced (blanking them would be a regression, not a state).
 */
export function screenState(input: {
  online: boolean;
  resultTypes: readonly ("unknown" | "complete" | "error")[];
  hasContent: boolean;
}): ScreenState {
  if (input.resultTypes.includes("error")) return "error";
  if (!input.online) return "offline";
  if (input.resultTypes.includes("unknown")) return "loading";
  return input.hasContent ? "ready" : "empty";
}

/** Banner copy. `ready` is an empty string = draw no banner. The screen is only ever missing *one*
 *  of its parts, never all of them, so every state except `ready` is a single line of text at the
 *  top rather than a screen of its own. */
export const STATE_COPY: Record<ScreenState, string> = {
  error: "Couldn't load the Today screen. Check the hub logs.",
  offline: "You're offline. Showing the last content we received.",
  loading: "Loading…",
  // A5 §3.4 words the empty state as "Quiet day today"; "Today is empty" says the same thing in a
  // way that sounds like a fault.
  empty: "Quiet day today — nothing on the calendar and nothing waiting on you.",
  ready: "",
};

export interface BriefItem {
  ref: { kind: string; id: string };
  line: string;
  why: string;
}

export interface BriefSection {
  id: string;
  title: string;
  items: BriefItem[];
}

export interface MorningBriefing {
  oneLiner: string;
  sections: BriefSection[];
}

/** US-B23 writes `digests.body` for kind='morning' as `JSON.stringify(MorningBriefing)`
 *  (packages/agents/src/digest/rank.ts), not as prose — the plan's `{morning.body}` in a <p> would
 *  print the raw JSON. Anything unreadable returns null and the section is skipped, rather than
 *  throwing on a row the hub wrote. `greeting` is deliberately dropped: the screen's own <h1>
 *  already greets, and printing two greetings is the one thing this screen must not do. */
export function parseMorningBriefing(body: string): MorningBriefing | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const brief = parsed as { one_liner?: unknown; sections?: unknown };
  if (typeof brief.one_liner !== "string" || !Array.isArray(brief.sections)) return null;
  const sections: BriefSection[] = [];
  for (const raw of brief.sections) {
    if (typeof raw !== "object" || raw === null) continue;
    const section = raw as { id?: unknown; title?: unknown; items?: unknown };
    if (typeof section.title !== "string" || !Array.isArray(section.items)) continue;
    const items: BriefItem[] = [];
    for (const rawItem of section.items) {
      if (typeof rawItem !== "object" || rawItem === null) continue;
      const item = rawItem as { ref?: unknown; line?: unknown; why?: unknown };
      const ref = item.ref as { kind?: unknown; id?: unknown } | undefined;
      if (typeof item.line !== "string" || typeof ref?.id !== "string") continue;
      items.push({
        ref: { kind: typeof ref.kind === "string" ? ref.kind : "item", id: ref.id },
        line: item.line,
        why: typeof item.why === "string" ? item.why : "",
      });
    }
    if (items.length === 0) continue;
    sections.push({
      id: typeof section.id === "string" ? section.id : section.title,
      title: section.title,
      items,
    });
  }
  return { oneLiner: brief.one_liner, sections };
}

/** 24-hour clock time ("10:00") — the A5 §3.4 mock formats the schedule this way. */
function clockTime(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(ms),
  );
}

/** ponytail: link resolution rides on the newest 200 items, the same bound the Inbox already puts
 *  on its own list. An overnight item older than that — or one whose row is not replicated —
 *  renders as plain text instead of a dead link. A per-id query would be exact, but its arguments
 *  would change on every digest write; this bound costs nothing and degrades to text. */
const ITEM_WINDOW = 200;

/** Reads Zero's online flag as React state. `zero.onOnline` returns the unsubscribe function
 *  `useSyncExternalStore` wants; the server-render/test snapshot assumes online, which is the
 *  quieter assumption (offline would paint an offline banner into every test render). */
function useZeroOnline(zero: ZeroClient): boolean {
  const subscribe = useCallback((cb: () => void) => zero.onOnline(() => cb()), [zero]);
  return useSyncExternalStore(
    subscribe,
    () => zero.online,
    () => true,
  );
}

export interface TodayProps {
  /** The display name in the greeting. Nothing in the schema holds it yet (delta §9's
   *  OMNIS_USER_ID is a machine identity, not a display name), so it defaults to the hub's
   *  single user and is overridable when that changes. */
  userName?: string;
  /** Click a briefing item → open its Thread (A5 §3.4). Without it the item is plain text. */
  onOpenThread?: (threadId: string) => void;
  /** "View →" on the nightly card → the Digest screen (§3.8, US-B32). Without it the card draws no
   *  button at all rather than a control that goes nowhere. */
  onOpenDigest?: () => void;
}

export function Today({ userName = "Logan", onOpenThread, onOpenDigest }: TodayProps) {
  const zero = useZeroClient();
  const [expandedApprovalId, setExpandedApprovalId] = useState<string | null>(null);
  // The screen's "today" is fixed for the life of the mount — recomputing it per render would make
  // the state decision depend on when React happened to re-render.
  const now = useMemo(() => new Date(), []);

  const online = useZeroOnline(zero);
  // One row, not the whole history of briefings: digests accumulate one per day, and every look at
  // this screen would otherwise materialize all of them. The same shape serves the nightly card.
  const [morningRows, morningR] = useQuery(
    zero.query.digests.where("kind", "=", "morning").orderBy("for_date", "desc").limit(1),
  );
  const [nightlyRows, nightlyR] = useQuery(
    zero.query.digests.where("kind", "=", "nightly").orderBy("for_date", "desc").limit(1),
  );
  // Deviation from the plan's `items.where(kind = 'event')`: one items query feeds both today's
  // calendar and the briefing's deep links, so the screen takes one subscription instead of two
  // overlapping ones. See ITEM_WINDOW for what the bound costs.
  const [recentItems, itemsR] = useQuery(
    zero.query.items.orderBy("sent_at", "desc").limit(ITEM_WINDOW),
  );
  // A5 §3.4 orders the chip strip by created_at asc, so the chip that has been waiting longest is
  // the first one in the row.
  const [approvals, approvalsR] = useQuery(
    zero.query.pending_approvals
      .where("state", "=", "pending")
      .orderBy("created_at", "asc")
      .limit(ITEM_WINDOW),
  );

  const morningRow = morningRows[0];
  const morning =
    morningRow && isSameLocalDay(new Date(morningRow.for_date), now) ? morningRow : null;
  const nightly = nightlyRows[0] ?? null;
  const briefing = useMemo(
    () => (morning === null ? null : parseMorningBriefing(morning.body)),
    [morning],
  );
  const threadByItemId = useMemo(
    () => new Map(recentItems.map((i) => [i.id, i.thread_id])),
    [recentItems],
  );
  const todaysEvents = useMemo(
    () =>
      recentItems
        .filter((i) => i.kind === "event" && isSameLocalDay(new Date(i.sent_at), now))
        .sort((a, b) => a.sent_at - b.sent_at),
    [recentItems, now],
  );
  const pendingCount = useMemo(
    () => todaysEvents.length + approvals.length,
    [todaysEvents, approvals],
  );

  const state = screenState({
    online,
    resultTypes: [morningR.type, nightlyR.type, itemsR.type, approvalsR.type],
    hasContent:
      morning !== null || nightly !== null || todaysEvents.length > 0 || approvals.length > 0,
  });
  const banner = STATE_COPY[state];

  const expandedApproval =
    expandedApprovalId === null ? undefined : approvals.find((a) => a.id === expandedApprovalId);

  return (
    <OpaqueSurface className="today-screen" data-state={state}>
      {banner !== "" && (
        <p
          className="today-screen__banner"
          data-state={state}
          role={state === "error" ? "alert" : "status"}
        >
          {banner}
        </p>
      )}

      <h1 className="today-screen__greeting">
        {greetingLine(userName, pendingCount, approvals.length, now)}
      </h1>

      {nightly && (
        <DigestCard
          kind="nightly"
          headline={`Nightly digest ready · ${nightly.item_ids.length} archived`}
          body=""
          {...(onOpenDigest ? { onOpen: onOpenDigest } : {})}
        />
      )}

      <section className="today-screen__section" aria-label="Today's schedule">
        <h2 className="today-screen__section-title">Today's schedule</h2>
        {todaysEvents.length === 0 ? (
          <p className="today-screen__quiet">Nothing on the calendar today.</p>
        ) : (
          <ul className="today-screen__events">
            {todaysEvents.map((e) => (
              <li key={e.id} className="today-screen__event">
                <span className="today-screen__event-time">{clockTime(e.sent_at)}</span>
                {onOpenThread ? (
                  <button
                    type="button"
                    className="today-screen__event-title"
                    onClick={() => onOpenThread(e.thread_id)}
                  >
                    {e.subject ?? e.body}
                  </button>
                ) : (
                  <span className="today-screen__event-title">{e.subject ?? e.body}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {briefing && (
        <section className="today-screen__section" aria-label="Morning briefing">
          <h2 className="today-screen__section-title">Morning briefing</h2>
          <p className="today-screen__lead">{briefing.oneLiner}</p>
          {briefing.sections.map((section) => (
            <div key={section.id} className="today-screen__brief-group">
              <h3 className="today-screen__brief-title">{section.title}</h3>
              <ul className="today-screen__brief-list">
                {section.items.map((item) => {
                  const threadId = threadByItemId.get(item.ref.id);
                  const key = `${item.ref.kind}:${item.ref.id}`;
                  const label = (
                    <>
                      <span className="today-screen__brief-line">{item.line}</span>
                      {item.why !== "" && (
                        <span className="today-screen__brief-why">{item.why}</span>
                      )}
                    </>
                  );
                  return (
                    <li key={key} className="today-screen__brief-item">
                      {/* A briefing item is only a link when its Thread is actually known here —
                          the digest stores item ids, and an item outside the replicated window
                          would otherwise become a button that goes nowhere. */}
                      {threadId !== undefined && onOpenThread ? (
                        <button
                          type="button"
                          className="today-screen__brief-button"
                          onClick={() => onOpenThread(threadId)}
                        >
                          {label}
                        </button>
                      ) : (
                        <div className="today-screen__brief-static">{label}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      {approvals.length > 0 && (
        <section className="today-screen__section" aria-label="Pending approvals">
          <h2 className="today-screen__section-title">Pending approvals ({approvals.length})</h2>
          <div className="today-screen__chips">
            {approvals.map((a) => (
              <button
                key={a.id}
                type="button"
                className="today-screen__chip"
                aria-expanded={expandedApprovalId === a.id}
                aria-label={`Pending approval: ${a.description}, requested ${formatRelativeTime(a.created_at)}`}
                onClick={() => setExpandedApprovalId((open) => (open === a.id ? null : a.id))}
              >
                {a.description}
              </button>
            ))}
          </div>
          {/* A5 §3.4: the chip expands the card in place — no navigation. Deciding it is the whole
              point of the strip (the briefing-coverage metric counts what got handled from here). */}
          {expandedApproval && (
            <ApprovalCardView
              className="today-screen__expanded"
              interrupt={{
                action: expandedApproval.action as ApprovalCardInterrupt["action"],
                description: expandedApproval.description,
                args: (expandedApproval.args ?? {}) as Record<string, unknown>,
                config: expandedApproval.config as ApprovalCardInterrupt["config"],
              }}
              onDecide={(decision, decidedArgs) => {
                setExpandedApprovalId(null);
                decideApproval(expandedApproval.id, decision, decidedArgs).catch((e: unknown) => {
                  console.error("approval decide failed", e);
                });
              }}
            />
          )}
        </section>
      )}
    </OpaqueSurface>
  );
}
