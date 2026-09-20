// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts,
// so the file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PersonCard } from "../src/components/person-card.js";
import { initialsFromName } from "../src/lib/row-meta.js";

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
