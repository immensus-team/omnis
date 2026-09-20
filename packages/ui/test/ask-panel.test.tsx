// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AskPanel } from "../src/components/ask-panel";

const panel = (threadSelected: boolean, summary: string | null) => (
  <AskPanel commands={null} threadSelected={threadSelected} summary={summary} onClose={vi.fn()} />
);

const tab = (name: string) => screen.getByRole("button", { name });

const summarize = () => screen.getByRole("button", { name: "이 대화 요약" });

describe("AskPanel 제안 액션 (US-D01)", () => {
  it("disables 이 대화 요약 while no thread is selected", () => {
    render(panel(false, null));
    expect(summarize()).toBeDisabled();
  });

  it("enables 이 대화 요약 once a thread is selected", () => {
    render(panel(true, null));
    expect(summarize()).not.toBeDisabled();
  });

  it('keeps 답장 초안 작성 / 할 일 추출 disabled with title="Phase B" regardless of selection', () => {
    render(panel(true, "테스트 요약"));
    for (const name of ["답장 초안 작성", "할 일 추출"]) {
      const action = screen.getByRole("button", { name });
      expect(action).toBeDisabled();
      expect(action).toHaveAttribute("title", "Phase B");
    }
  });
});

describe("AskPanel 요약 표시 (US-D01)", () => {
  it("reveals summary once 이 대화 요약 is pressed", () => {
    render(panel(true, "테스트 요약"));
    expect(screen.queryByText("테스트 요약")).toBeNull();

    fireEvent.click(summarize());
    expect(screen.getByText("테스트 요약")).toBeInTheDocument();
  });

  it("falls back to 아직 요약 없음 when summary is null", () => {
    render(panel(true, null));
    fireEvent.click(summarize());

    expect(screen.getByText("아직 요약 없음")).toBeInTheDocument();
  });
});

describe("AskPanel 탭 전환 (US-D01 회귀: 타이핑이 막다른 길이 되면 안 된다)", () => {
  it("shows 제안 while the ask bar query is empty", () => {
    render(
      <AskPanel
        commands={<p>명령 목록</p>}
        threadSelected
        summary={null}
        query=""
        onClose={vi.fn()}
      />,
    );
    expect(tab("제안")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("명령 목록")).toBeNull();
  });

  it("auto-switches to 명령 as soon as the query is non-empty", () => {
    const { rerender } = render(
      <AskPanel
        commands={<p>명령 목록</p>}
        threadSelected
        summary={null}
        query=""
        onClose={vi.fn()}
      />,
    );
    rerender(
      <AskPanel
        commands={<p>명령 목록</p>}
        threadSelected
        summary={null}
        query=">"
        onClose={vi.fn()}
      />,
    );
    expect(tab("명령")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("명령 목록")).toBeInTheDocument();
  });

  it("falls back to 제안 when the query clears again", () => {
    const { rerender } = render(
      <AskPanel
        commands={<p>명령 목록</p>}
        threadSelected
        summary={null}
        query="go"
        onClose={vi.fn()}
      />,
    );
    rerender(
      <AskPanel
        commands={<p>명령 목록</p>}
        threadSelected
        summary={null}
        query=""
        onClose={vi.fn()}
      />,
    );
    expect(tab("제안")).toHaveAttribute("aria-pressed", "true");
  });

  it("lets an explicit tab click win over the query-derived tab", () => {
    render(
      <AskPanel
        commands={<p>명령 목록</p>}
        threadSelected
        summary={null}
        query="go"
        onClose={vi.fn()}
      />,
    );
    expect(tab("명령")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tab("제안"));
    expect(tab("제안")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("명령 목록")).toBeNull();
  });
});

describe("AskPanel 컨텍스트 줄 (US-D01)", () => {
  it("names the selected thread so the actions have a visible target", () => {
    render(
      <AskPanel
        commands={null}
        threadSelected
        threadTitle="omnis launch sync"
        summary={null}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("omnis launch sync")).toBeInTheDocument();
  });

  it("says so when nothing is selected", () => {
    render(panel(false, null));
    expect(screen.getByText("선택된 스레드 없음")).toBeInTheDocument();
  });
});
