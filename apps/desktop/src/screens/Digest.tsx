import { ChevronRightIcon, OpaqueSurface, StatusPill } from "@omnis/ui";
import { useQuery } from "@rocicorp/zero/react";
import { useMemo, useState } from "react";
import { unarchiveItem, undoDigestGroup } from "../api/digest.js";
import { type ZeroClient, useZeroClient } from "../zero-client.js";

/** A4 §6.4's auto-archive category, as `nightlyGroups` writes it (packages/agents/src/loops/
 *  digest-nightly.ts). `count` is the whole category; `samples` is only ever the newest three. */
export interface DigestSample {
  ref: { kind: string; id: string };
  line: string;
  why: string;
}

export interface DigestGroup {
  reason: string;
  count: number;
  samples: DigestSample[];
  /** The token every item in this category was archived under (US-B32), which is what the hub's
   *  group restore matches on. */
  undo_token: string;
}

export interface DigestCost {
  month_to_date_usd: number;
  cap_usd: number;
}

/** US-B24 writes `digests.body` as `JSON.stringify(NightlyDigest)`, not as prose (the same thing
 *  US-B23 does for the morning briefing and for the same reason: Today.tsx's `{morning.body}` in a
 *  <p> would print raw JSON). Everything below reads that text rather than trusting it — a row the
 *  hub wrote badly has to draw an empty digest, never throw inside a render. */
export function digestGroups(body: string): DigestGroup[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const auto = (parsed as { auto_archived?: unknown }).auto_archived;
  if (!Array.isArray(auto)) return [];

  const groups: DigestGroup[] = [];
  for (const entry of auto) {
    if (typeof entry !== "object" || entry === null) continue;
    const g = entry as Record<string, unknown>;
    // A group with no reason to show, no count to report or no token to restore with is not one of
    // A5 §3.8's categories; dropping it beats drawing a header whose Restore button reaches nothing.
    if (typeof g.reason !== "string" || g.reason === "") continue;
    if (typeof g.count !== "number" || !Number.isFinite(g.count)) continue;
    if (typeof g.undo_token !== "string" || g.undo_token === "") continue;
    if (!Array.isArray(g.samples)) continue;

    const samples: DigestSample[] = [];
    for (const raw of g.samples) {
      if (typeof raw !== "object" || raw === null) continue;
      const s = raw as { ref?: unknown; line?: unknown; why?: unknown };
      const ref = s.ref as { kind?: unknown; id?: unknown } | undefined;
      if (typeof s.line !== "string" || typeof ref?.id !== "string" || ref.id === "") continue;
      samples.push({
        ref: { kind: typeof ref.kind === "string" ? ref.kind : "item", id: ref.id },
        line: s.line,
        why: typeof s.why === "string" ? s.why : "",
      });
    }
    groups.push({
      reason: g.reason,
      count: g.count,
      samples,
      undo_token: g.undo_token,
    });
  }
  return groups;
}

/** `digests.metrics` is the loop's flat summary of the same night (`{archived, cost_mtd_usd}` —
 *  nightlyDigestLoop.apply), and it is what the screen's total comes from; the group counts are the
 *  fallback for a row whose metrics are missing or a different shape. */
export function archivedCount(metrics: unknown, groups: readonly DigestGroup[]): number {
  if (typeof metrics === "object" && metrics !== null) {
    const archived = (metrics as { archived?: unknown }).archived;
    if (typeof archived === "number" && Number.isFinite(archived)) return archived;
  }
  return groups.reduce((total, g) => total + g.count, 0);
}

/** The cost the digest recorded, or null when it recorded none — A5 §3.8's report is what the night
 *  reported, so a row without one draws no line rather than a line computed from somewhere else. */
export function digestCost(body: string): DigestCost | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const cost = (parsed as { cost?: unknown }).cost;
  if (typeof cost !== "object" || cost === null) return null;
  const c = cost as { month_to_date_usd?: unknown; cap_usd?: unknown };
  if (typeof c.month_to_date_usd !== "number" || !Number.isFinite(c.month_to_date_usd)) return null;
  if (typeof c.cap_usd !== "number" || !Number.isFinite(c.cap_usd)) return null;
  return { month_to_date_usd: c.month_to_date_usd, cap_usd: c.cap_usd };
}

/** The digest is filed under a KST calendar day (`digests.for_date`, written as `now() AT TIME ZONE
 *  'Asia/Seoul'`), so its label has to be that day and not the browser's — a reader in another zone
 *  would otherwise see last night's digest dated yesterday. */
export function digestDayLabel(forDate: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date(forDate));
}

/** A5 §3.8's heading. The design checklist rules out middle-dot metadata (§SKILLS 12-line list,
 *  item 5), so the date and the count are one sentence rather than "September 19 night digest · 42
 *  archived"; a night with nothing archived says so instead of reporting a zero. */
export function digestHeading(forDate: number, archived: number): string {
  const day = digestDayLabel(forDate);
  return archived === 0
    ? `${day} night digest, nothing archived`
    : `${day} night digest, ${String(archived)} archived`;
}

/** A5 §3.8: "monthly cost report: $34 / $60 (57%)" — the month-to-date spend over the cap, the UI
 *  exposure point of master §14's cost policy. A cap of 0 has no percentage to report. */
export function monthlyCostLine(cost: DigestCost): string {
  const dollars = `$${String(cost.month_to_date_usd)} / $${String(cost.cap_usd)}`;
  if (cost.cap_usd <= 0) return `Monthly cost report: ${dollars}`;
  const pct = Math.round((cost.month_to_date_usd / cost.cap_usd) * 100);
  return `Monthly cost report: ${dollars} (${String(pct)}%)`;
}

/** What a restore is announced as (role="status"). Zero restored is a real answer — the group was
 *  already restored, or its items are older than the 7-day undo window — so it says that rather
 *  than reporting a failure the user can do nothing about. */
export function restoreStatusLine(restored: number): string {
  if (restored === 0) return "Nothing left to restore — those items are already back.";
  return `Restored ${String(restored)} archived ${restored === 1 ? "item" : "items"}.`;
}

export type DigestState = "error" | "loading" | "ready";

/** The query's own state — the same shape Today and Network use. Zero keeps serving the rows it has
 *  already synced, so a failed or offline query shows the last digest rather than a blank screen. */
export function digestState(
  resultTypes: readonly ("unknown" | "complete" | "error")[],
): DigestState {
  if (resultTypes.includes("error")) return "error";
  return resultTypes.includes("unknown") ? "loading" : "ready";
}

export const DIGEST_BANNER: Record<DigestState, string> = {
  error: "Couldn't load the digest. Check the hub logs.",
  loading: "Loading tonight's digest…",
  ready: "",
};

/** A5 §3.8's loading/empty copy: the digest is generated daily at 23:00 KST, so "not there yet" is
 *  the normal state for most of the day and has to read as a schedule, not as a fault. */
export const DIGEST_WAITING_COPY =
  "Tonight's digest isn't ready yet — it's created at 23:00, and it lists what was auto-archived today.";

export const DIGEST_EMPTY_COPY = "Nothing was auto-archived today.";

/** Is tonight's digest built? The row exists from 22:40 — US-C17's `followup_miss` job files its
 *  metric on it twenty minutes before the loop that writes the body — so "a row is there" is not the
 *  same question as "the digest has run". The body is what makes it a digest: empty means the night
 *  has not been summarized yet, and the answer is the schedule copy rather than "nothing was
 *  auto-archived today", which would be a report of a night that has not been read. */
export function digestIsBuilt<T extends { body: string }>(digest: T | undefined): digest is T {
  return digest !== undefined && digest.body !== "";
}

export interface DigestProps {
  /** US-B32 (the plan's step 7): the seam the Thread header's banner and a toast library would
   *  subscribe to. Nothing in the app passes it yet — the Thread banner is §3.2's story — so it is
   *  handed the count and nothing else. */
  onRestored?: (restored: number) => void;
}

interface Notice {
  kind: "status" | "alert";
  text: string;
}

export function Digest({ onRestored }: DigestProps) {
  const zero: ZeroClient = useZeroClient();
  // One row: digests accumulate one per night, and every look at this screen would otherwise
  // materialize the whole history (the same bound Today puts on its own read).
  const [rows, result] = useQuery(
    zero.query.digests.where("kind", "=", "nightly").orderBy("for_date", "desc").limit(1),
  );
  const digest = rows[0];

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  /** Restores are optimistic: the digest row is a record of the night and never changes, so what a
   *  human just put back has to be remembered here or the screen would offer to restore it again. */
  const [restoredGroups, setRestoredGroups] = useState<ReadonlySet<string>>(new Set());
  const [restoredItems, setRestoredItems] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);

  const body = digest?.body ?? "";
  const groups = useMemo(() => digestGroups(body), [body]);
  const cost = useMemo(() => digestCost(body), [body]);
  const state = digestState([result.type]);

  function toggle(token: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  }

  async function restoreItem(id: string): Promise<void> {
    try {
      await unarchiveItem(id);
      setRestoredItems((prev) => new Set(prev).add(id));
      setNotice({ kind: "status", text: restoreStatusLine(1) });
      onRestored?.(1);
    } catch {
      setNotice({ kind: "alert", text: "Couldn't restore that item. Try again." });
    }
  }

  async function restoreGroup(group: DigestGroup): Promise<void> {
    if (digest === undefined) return;
    try {
      const { restored } = await undoDigestGroup(digest.id, group.undo_token);
      setRestoredGroups((prev) => new Set(prev).add(group.undo_token));
      setNotice({ kind: "status", text: restoreStatusLine(restored) });
      onRestored?.(restored);
    } catch {
      setNotice({ kind: "alert", text: "Couldn't restore that group. Try again." });
    }
  }

  const banner = DIGEST_BANNER[state];

  return (
    <OpaqueSurface className="digest-screen" data-state={state}>
      {banner !== "" && (
        <p
          className="digest-screen__banner"
          data-state={state}
          role={state === "error" ? "alert" : "status"}
        >
          {banner}
        </p>
      )}

      {digest === undefined || !digestIsBuilt(digest) ? (
        <p className="digest-screen__waiting">{DIGEST_WAITING_COPY}</p>
      ) : (
        <>
          <header className="digest-screen__head">
            <h1 className="digest-screen__title">
              {digestHeading(digest.for_date, archivedCount(digest.metrics, groups))}
            </h1>
          </header>

          {notice !== null && (
            <p className="digest-screen__notice" role={notice.kind}>
              {notice.text}
            </p>
          )}

          {/* A5 §3.8's category accordion. Closed by default: the screen's question is "was anything
              worth revisiting", and the answer is the category line and its count. */}
          {groups.length === 0 ? (
            <p className="digest-screen__empty">{DIGEST_EMPTY_COPY}</p>
          ) : (
            <ul className="digest-screen__groups">
              {groups.map((group) => {
                const open = expanded.has(group.undo_token);
                const restored = restoredGroups.has(group.undo_token);
                const hidden = Math.max(group.count - group.samples.length, 0);
                return (
                  <li
                    key={group.undo_token}
                    className="digest-screen__group"
                    data-restored={restored ? "true" : undefined}
                  >
                    <div className="digest-screen__group-head">
                      <button
                        type="button"
                        className="digest-screen__group-toggle"
                        aria-expanded={open}
                        onClick={() => toggle(group.undo_token)}
                      >
                        <ChevronRightIcon
                          className="digest-screen__chevron"
                          size={14}
                          aria-hidden="true"
                        />
                        <StatusPill tone="neutral" label={group.reason} />
                        <span className="digest-screen__count">{group.count}</span>
                      </button>
                      {!restored && (
                        <button
                          type="button"
                          className="digest-screen__action"
                          onClick={() => void restoreGroup(group)}
                        >
                          Restore all
                        </button>
                      )}
                    </div>

                    {open && (
                      <ul className="digest-screen__samples">
                        {group.samples.map((sample) => {
                          const back = restored || restoredItems.has(sample.ref.id);
                          return (
                            <li
                              key={sample.ref.id}
                              className="digest-screen__sample"
                              data-restored={back ? "true" : undefined}
                            >
                              <span className="digest-screen__sample-line">{sample.line}</span>
                              {back ? (
                                <span className="digest-screen__sample-state">Restored</span>
                              ) : (
                                <button
                                  type="button"
                                  className="digest-screen__action"
                                  aria-label={`Restore ${sample.line}`}
                                  onClick={() => void restoreItem(sample.ref.id)}
                                >
                                  Restore
                                </button>
                              )}
                            </li>
                          );
                        })}
                        {hidden > 0 && (
                          <li className="digest-screen__more">
                            and {hidden} more (the digest lists the newest three)
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {cost !== null && (
            <section className="digest-screen__cost" aria-label="Monthly cost report">
              <p className="digest-screen__cost-line">{monthlyCostLine(cost)}</p>
            </section>
          )}
        </>
      )}
    </OpaqueSurface>
  );
}
