// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts,
// so the file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PersonCard, relationshipDot } from "../src/components/person-card.js";
import { initialsFromName } from "../src/lib/row-meta.js";

describe("relationshipDot (A5 §3.6 — six stored states, three levels)", () => {
  it("maps active to active", () => {
    expect(relationshipDot("active")).toBe("active");
  });

  it("maps new and warming to warming (a relationship forming)", () => {
    expect(relationshipDot("new")).toBe("warming");
    expect(relationshipDot("warming")).toBe("warming");
  });

  it("maps dormant and closed to dormant (gone cold)", () => {
    expect(relationshipDot("dormant")).toBe("dormant");
    expect(relationshipDot("closed")).toBe("dormant");
  });

  it("maps unknown to unknown, which draws no dot", () => {
    expect(relationshipDot("unknown")).toBe("unknown");
  });
});

describe("PersonCard (US-D03: the reference's photo + badge + key-value block)", () => {
  it("falls back to initials when the person has no photo", () => {
    render(<PersonCard person={{ name: "Scarlett Johansen" }} />);
    expect(screen.getByText(initialsFromName("Scarlett Johansen"))).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("draws a photo when there is one", () => {
    // alt="" on purpose: the name is right next to it, so the image is decorative and carries no
    // role. It is found by tag rather than by role for the same reason.
    const { container } = render(
      <PersonCard person={{ name: "Scarlett Johansen", photoUrl: "/s.jpg" }} />,
    );
    expect(container.querySelector(".person-card__avatar-img")).toHaveAttribute("src", "/s.jpg");
  });

  it("renders the person's fields as key-value rows", () => {
    render(
      <PersonCard
        person={{
          name: "Robert Downey Jr",
          channels: ["gmail", "slack"],
          lastContact: "3m",
          relationshipState: "active",
        }}
      />,
    );
    expect(screen.getByText("Channels")).toBeInTheDocument();
    expect(screen.getByText("Gmail, Slack")).toBeInTheDocument();
    expect(screen.getByText("Last contact")).toBeInTheDocument();
    expect(screen.getByText("3m")).toBeInTheDocument();
    expect(screen.getByText("Relationship")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("leaves out a row it has nothing to say for", () => {
    // relationship_state defaults to 'unknown' — "Relationship: unknown" is a row that took up
    // space to report that nobody filled the column in.
    render(<PersonCard person={{ name: "Dana Lee", relationshipState: "unknown" }} />);
    expect(screen.queryByText("Relationship")).not.toBeInTheDocument();
    expect(screen.queryByText("Last contact")).not.toBeInTheDocument();
    expect(screen.queryByText("Channels")).not.toBeInTheDocument();
  });

  it("puts labels in the badge row and not in the table", () => {
    // One fact, one place: a Labels table row under a badge row of the same labels is the card
    // answering its own question twice.
    render(<PersonCard person={{ name: "Dana Lee", labels: ["contract", "launch"] }} />);
    expect(screen.getByText("contract")).toBeInTheDocument();
    expect(screen.getByText("launch")).toBeInTheDocument();
    expect(screen.queryByText("Labels")).not.toBeInTheDocument();
  });

  it("shows VIP only when the person is one", () => {
    const { rerender } = render(<PersonCard person={{ name: "Dana Lee" }} />);
    expect(screen.queryByText("VIP")).not.toBeInTheDocument();
    rerender(<PersonCard person={{ name: "Dana Lee", vip: true }} />);
    expect(screen.getByText("VIP")).toBeInTheDocument();
  });

  it("renders caller rows after the person's own", () => {
    render(
      <PersonCard
        person={{ name: "Dana Lee", lastContact: "1h" }}
        extraRows={[{ label: "Unread", value: 2, numeric: true }]}
      />,
    );
    expect(screen.getByText("Unread")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("PersonCard — A5 §3.6 Network fields (US-B30)", () => {
  it("prints affiliation and title under the name", () => {
    render(<PersonCard person={{ name: "David Park", org: "Davich", role: "CTO" }} />);
    expect(screen.getByText("Davich · CTO")).toBeInTheDocument();
  });

  it("drops the separator when only one of org/role is known", () => {
    // " · CTO" and "Davich · " are both strings, and both read as a field that failed to load.
    render(<PersonCard person={{ name: "David Park", role: "CTO" }} />);
    expect(screen.getByText("CTO")).toBeInTheDocument();
    expect(screen.queryByText(" · CTO")).not.toBeInTheDocument();

    render(<PersonCard person={{ name: "Sora Kim", org: "Ownered Lab" }} />);
    expect(screen.getByText("Ownered Lab")).toBeInTheDocument();
  });

  it("carries the three-level dot alongside the state's own word", () => {
    // A5 §3.6: the dot has 3 levels, the label keeps the precise state — so `new` and `warming`
    // share a dot colour but not a word, and neither is readable by colour alone.
    const { rerender } = render(
      <PersonCard person={{ name: "David Park", relationshipState: "active" }} />,
    );
    expect(screen.getByText("Active").closest(".status-pill")).toHaveAttribute(
      "data-dot",
      "active",
    );

    rerender(<PersonCard person={{ name: "David Park", relationshipState: "new" }} />);
    expect(screen.getByText("New").closest(".status-pill")).toHaveAttribute("data-dot", "warming");

    rerender(<PersonCard person={{ name: "David Park", relationshipState: "closed" }} />);
    expect(screen.getByText("Closed").closest(".status-pill")).toHaveAttribute(
      "data-dot",
      "dormant",
    );
  });

  it("makes the name a button only when there is somewhere to open", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<PersonCard person={{ name: "David Park" }} />);
    // The hover card has no detail pane behind it, so its card is not a control.
    expect(screen.queryByRole("button", { name: "David Park" })).not.toBeInTheDocument();

    rerender(<PersonCard person={{ name: "David Park" }} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "David Park" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
