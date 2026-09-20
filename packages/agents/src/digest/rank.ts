// A4 §6.3: 랭킹은 LLM이 하지 않는다. 산술 점수로 정렬하고 LLM은 한 줄 요약만 쓴다.
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
  /** 내가 마지막으로 답한 뒤 상대가 보낸 미응답 턴 수. 3으로 클램프된다. */
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

/** A4 §6.3의 8항 가중합 중 7항. 8번째 항(-1.0 * 같은 스레드 중복)은 감점이 아니라
 *  rankBriefItems의 하드 dedupe로 실현된다 — 스레드당 1회가 §6.3 마지막 항의 요구다. */
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

/** 한 스레드는 브리핑 전체에서 최대 1회 등장한다(A4 §6.3 마지막 항). */
export function rankBriefItems(rows: BriefCandidate[], now: Date): BriefItem[] {
  void now; // ageHours가 이미 수집 시점에 계산돼 온다(A4 §6.3). 시그니처는 델타 §4 고정.
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
