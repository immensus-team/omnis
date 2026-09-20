import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "../src/components/status-badge";

describe("StatusBadge (A3 items.status enum, 7값)", () => {
  it.each([
    ["received", "받음"],
    ["read", "읽음"],
    ["draft", "초안"],
    ["approved", "승인됨"],
    ["sent", "전송됨"],
    ["failed", "실패"],
    ["archived", "보관됨"],
  ] as const)("%s → %s", (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toHaveAttribute("data-status", status);
  });
});
