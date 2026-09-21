// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts,
// so the file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DigestCard } from "../src/components/digest-card.js";

describe("DigestCard (A5 §5.2 shared by morning/nightly)", () => {
  it("renders headline + body and calls onOpen", () => {
    const onOpen = vi.fn();
    render(
      <DigestCard
        kind="nightly"
        headline="Nightly digest ready · 42 archived"
        body="September 19"
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText("Nightly digest ready · 42 archived")).toBeInTheDocument();
    fireEvent.click(screen.getByText("View →"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("omits the open button when onOpen is not given", () => {
    render(<DigestCard kind="morning" headline="Morning briefing" body="" />);
    expect(screen.queryByText("View →")).not.toBeInTheDocument();
  });

  // The card is the entry point for two different digests and A5 §3.4 renders both the morning
  // briefing and the nightly card on the same screen — the kind has to be readable off the DOM, or
  // nothing in CSS or a test can tell the two apart.
  it("carries its kind on the surface", () => {
    render(<DigestCard kind="morning" headline="Morning briefing" body="4 overnight items" />);
    expect(screen.getByText("Morning briefing").closest("[data-digest-kind]")).toHaveAttribute(
      "data-digest-kind",
      "morning",
    );
  });

  // An empty body is not an empty line: the card's second row collapses instead of leaving a gap
  // (the same rule the Inbox summary follows when there is nothing left to say).
  it("draws no body line for an empty body", () => {
    const { container } = render(
      <DigestCard kind="nightly" headline="Nightly digest ready" body="" />,
    );
    expect(container.querySelector(".digest-card__body")).toBeNull();
  });
});
