// A4 §6.3: the LLM does not do the ranking. Sort by arithmetic score; the LLM only writes the one-liner.
export type BriefSectionId = "needs_you" | "drafts" | "calendar" | "commitments" | "agents";

export interface BriefItem {
  ref: { kind: "item" | "task" | "approval" | "event" | "session"; id: string };
  line: string;
  why: string;
  action?: "approve" | "open" | "snooze";
}

export interface BriefCandidate extends BriefItem {
  thread_id: string;
  section: BriefSectionId;
  priority: "now" | "today" | "week" | "fyi";
  vip: boolean;
  pendingApproval: boolean;
  /** Unanswered turns the other party sent since my last reply. Clamped to 3. */
  unansweredTurns: number;
  meetingToday: boolean;
  dueToday: boolean;
  ageHours: number;
  snoozed: boolean;
}

export interface BriefSection {
  id: BriefSectionId | "quiet";
  title: string;
  items?: BriefItem[];
  count?: number;
}

export interface MorningBriefing {
  greeting: string;
  sections: BriefSection[];
  one_liner: string;
}

export const SECTION_CAPS: Record<BriefSectionId, number> = {
  needs_you: 5,
  drafts: 7,
  calendar: Number.POSITIVE_INFINITY,
  commitments: 5,
  agents: 5,
};

const PRIORITY_WEIGHT: Record<BriefCandidate["priority"], number> = {
  now: 1,
  today: 0.6,
  week: 0.25,
  fyi: 0,
};

/** 7 of the 8 weighted terms in A4 §6.3. The 8th term (-1.0 * duplicate same thread) is not a
 *  penalty but is realized by the hard dedupe in rankBriefItems — once per thread is what the
 *  last term of §6.3 requires. */
function score(c: BriefCandidate): number {
  return (
    3.0 * PRIORITY_WEIGHT[c.priority] +
    2.5 * (c.vip ? 1 : 0) +
    2.0 * (c.pendingApproval ? 1 : 0) +
    1.5 * (Math.min(3, c.unansweredTurns) / 3) +
    1.5 * (c.meetingToday ? 1 : 0) +
    1.0 * (c.dueToday ? 1 : 0) +
    0.8 * Math.exp(-c.ageHours / 24) -
    2.0 * (c.snoozed ? 1 : 0)
  );
}

/** A thread appears at most once in the whole briefing (last term of A4 §6.3). */
export function rankBriefItems(rows: BriefCandidate[], now: Date): BriefItem[] {
  void now; // ageHours arrives already computed at collection time (A4 §6.3). Signature fixed by delta §4.
  const sorted = [...rows].sort((a, b) => score(b) - score(a));
  const seen = new Set<string>();
  const out: BriefItem[] = [];
  for (const c of sorted) {
    if (seen.has(c.thread_id)) continue;
    seen.add(c.thread_id);
    out.push({
      ref: c.ref,
      line: c.line,
      why: c.why,
      ...(c.action !== undefined ? { action: c.action } : {}),
    });
  }
  return out;
}
