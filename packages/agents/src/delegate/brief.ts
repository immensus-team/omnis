// A4 §5.3: 브리프는 자기완결적이어야 한다 — 대상 런타임은 omnis의 컨텍스트를 모른다.
export interface BriefInput {
  goal: string;
  /** 각 줄 끝에 (item:xxx) 또는 (memory:xxx). 3~6줄. */
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
    "## 목표",
    i.goal,
    "",
    "## 배경",
    ...(i.background.length === 0 ? ["(배경 없음)"] : i.background),
    "",
    "## 해야 할 일",
    ...i.steps.map((s, n) => `${n + 1}. ${s}`),
    "",
    "## 수용 기준",
    ...i.acceptance.map((a) => `- [ ] ${a}`),
    "",
    "## 검증 명령",
    i.verifyCmd,
    "",
    "## 작업 디렉터리",
    i.workdir,
    "",
    "## 금지",
    "- 이 브리프에 없는 파일을 수정하지 않는다",
    "- 커밋/푸시하지 않는다 (omnis가 diff를 받아 사람에게 보여준다)",
  ].join("\n");
}
