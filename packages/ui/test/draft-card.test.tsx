import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DraftCard } from "../src/components/draft-card";

describe("DraftCard (A5-D9)", () => {
  it("shows full body (no truncation) and rationale", () => {
    render(
      <DraftCard
        body="네 확인했습니다, 내일 오전에 코멘트 드릴게요"
        rationale="PROJECTS.md #davich"
        onEditAndSend={vi.fn()}
        onDiscard={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    expect(screen.getByText("네 확인했습니다, 내일 오전에 코멘트 드릴게요")).toBeInTheDocument();
    expect(screen.getByText(/PROJECTS.md #davich/)).toBeInTheDocument();
  });
  it("wires the 3 buttons to their callbacks (§8 마이크로카피 한국어)", () => {
    const onEditAndSend = vi.fn();
    const onDiscard = vi.fn();
    const onRegenerate = vi.fn();
    render(
      <DraftCard
        body="b"
        rationale="r"
        onEditAndSend={onEditAndSend}
        onDiscard={onDiscard}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByText("수정 후 보내기"));
    expect(onEditAndSend).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("버리기"));
    expect(onDiscard).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("다시 생성"));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });
});
