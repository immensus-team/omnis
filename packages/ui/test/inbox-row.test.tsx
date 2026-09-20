// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InboxRow } from "../src/components/inbox-row";

const baseProps = {
  id: "item-1", title: "Sora Kim", preview: "회의 자료 확인 부탁드립니다", channel: "slack" as const,
  timestamp: "09:14", status: "received" as const, unread: true, selected: false, hasPendingApproval: false,
  labels: [{ kind: "scope" as const, name: "work", color: null }, { kind: "topic" as const, name: "davich", color: "#4f8" }],
  onSelect: vi.fn(),
};

describe("InboxRow (A5 §3.1)", () => {
  it("renders title, preview, and calls onSelect with id on click", () => {
    render(<InboxRow {...baseProps} />);
    expect(screen.getByText("Sora Kim")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option"));
    expect(baseProps.onSelect).toHaveBeenCalledWith("item-1");
  });
  it("shows at most 2 chips + N more, scope label first (A5 §3.1 우선순위)", () => {
    render(<InboxRow {...baseProps} labels={[
      { kind: "topic", name: "a", color: null }, { kind: "scope", name: "work", color: null },
      { kind: "person", name: "b", color: null },
    ]} />);
    expect(screen.getByLabelText("scope 라벨: work")).toBeInTheDocument();
    expect(screen.getByLabelText("라벨 1개 더 보기")).toHaveTextContent("+1");
  });
  it("prefixes draft items with '초안: ' (A5 §3.1)", () => {
    render(<InboxRow {...baseProps} status="draft" preview="네 확인했습니다" />);
    expect(screen.getByText("초안: 네 확인했습니다")).toBeInTheDocument();
  });
});
