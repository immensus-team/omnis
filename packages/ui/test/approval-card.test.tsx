// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type ApprovalCardInterrupt, ApprovalCardView } from "../src/components/approval-card.js";

const interrupt: ApprovalCardInterrupt = {
  action: "send",
  description: "Gmail 답장: David Park에게",
  config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
};

describe("ApprovalCardView (A5-D10, HumanInterrupt 4-way)", () => {
  it("renders only the buttons the config allows", () => {
    render(<ApprovalCardView interrupt={interrupt} onDecide={vi.fn()} />);
    expect(screen.getByText("승인")).toBeInTheDocument();
    expect(screen.getByText("수정 후 승인")).toBeInTheDocument();
    expect(screen.queryByText("응답")).not.toBeInTheDocument();
    expect(screen.getByText("무시")).toBeInTheDocument();
  });

  it("accept calls onDecide('accept')", () => {
    const onDecide = vi.fn();
    render(<ApprovalCardView interrupt={interrupt} onDecide={onDecide} />);
    fireEvent.click(screen.getByText("승인"));
    expect(onDecide).toHaveBeenCalledWith("accept", undefined);
  });
});
