// @vitest-environment jsdom
// The root `pnpm test` does not read apps/web/vitest.config.ts — see app.test.tsx.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InstallGuideCard } from "../src/components/InstallGuideCard.js";

describe("InstallGuideCard (A5 §4.5: share → Add to Home Screen → done)", () => {
  it("walks the three steps in order", () => {
    render(<InstallGuideCard onDismiss={() => undefined} />);
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain("Share");
    expect(steps[1]).toContain("Add to Home Screen");
    expect(steps[2]).not.toBe("");
  });

  it("is announced as the Add to Home Screen dialog and can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<InstallGuideCard onDismiss={onDismiss} />);
    expect(screen.getByRole("dialog", { name: "Add to Home Screen" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
