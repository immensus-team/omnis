// A4 §5.3: the brief must be self-contained — the target runtime does not know omnis's context.
export interface BriefInput {
  goal: string;
  /** Each line ends with (item:xxx) or (memory:xxx). 3–6 lines. */
  background: string[];
  steps: string[];
  acceptance: string[];
  verifyCmd: string;
  workdir: string;
}

export function renderBrief(i: BriefInput): string {
  if (i.acceptance.length === 0) {
    throw new Error("brief.acceptance must not be empty (A4 §5.3 minItems 1)");
  }
  return [
    "## Goal",
    i.goal,
    "",
    "## Background",
    ...(i.background.length === 0 ? ["(no background)"] : i.background),
    "",
    "## Steps",
    ...i.steps.map((s, n) => `${n + 1}. ${s}`),
    "",
    "## Acceptance Criteria",
    ...i.acceptance.map((a) => `- [ ] ${a}`),
    "",
    "## Verify Command",
    i.verifyCmd,
    "",
    "## Workdir",
    i.workdir,
    "",
    "## Do Not",
    "- Do not modify files that are not in this brief",
    "- Do not commit or push (omnis takes the diff and shows it to a human)",
  ].join("\n");
}
