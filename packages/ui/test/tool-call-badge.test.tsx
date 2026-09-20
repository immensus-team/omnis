// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TOOL_LABELS, ToolCallBadge } from "../src/components/tool-call-badge";

describe("TOOL_LABELS / ToolCallBadge (A5-D11)", () => {
  it("covers all 8 master §11 tool names", () => {
    expect(Object.keys(TOOL_LABELS).sort()).toEqual(
      [
        "propose_delegation",
        "propose_draft",
        "propose_route",
        "propose_task",
        "read",
        "read_calendar",
        "read_session",
        "search_memory",
      ].sort(),
    );
  });
  it("loading state is aria-busy, done state shows the result summary", () => {
    const { rerender } = render(<ToolCallBadge tool="read" state="loading" />);
    expect(screen.getByText("읽는 중").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
    rerender(<ToolCallBadge tool="read" state="done" resultSummary="3개 파일" />);
    expect(screen.getByText(/3개 파일/)).toBeInTheDocument();
  });
  it("throws for an unmapped tool name (fail fast, not a silent blank badge)", () => {
    // @ts-expect-error deliberately invalid tool for the failure-path assertion
    expect(() => render(<ToolCallBadge tool="delete" state="done" />)).toThrow(/unknown tool/);
  });
});
