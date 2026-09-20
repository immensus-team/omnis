// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type FilterChip,
  FilterChipBar,
  type FilterChipOption,
} from "../src/components/filter-chip-bar";

const OPTIONS: FilterChipOption[] = [
  { id: "l1", label: "Integrations" },
  { id: "l2", label: "Billing" },
];

function addOptions(over: Partial<{ selectedIds: string[]; onToggle: (id: string) => void }> = {}) {
  return {
    fieldLabel: "Label",
    options: OPTIONS,
    selectedIds: [],
    onToggle: vi.fn(),
    ...over,
  };
}

describe("FilterChipBar (US-D02)", () => {
  // The reference's chip (ref-issue-tracker-density.webp) is not one run-together sentence but
  // cells with alternating fills — `[Priority][is any of][2 priorities][x]`. That structure is
  // this component's contract.
  it("draws each chip as a field cell and a value cell, not one flat string", () => {
    const chips: FilterChip[] = [
      { id: "channel", field: "Channel", value: "Slack", onRemove: vi.fn() },
      { id: "labels", field: "Label", value: "one of 2", onRemove: vi.fn() },
    ];
    const { container } = render(<FilterChipBar chips={chips} />);

    const cells = [...container.querySelectorAll(".filter-chip")].map((chip) => [
      chip.querySelector(".filter-chip__field")?.textContent,
      chip.querySelector(".filter-chip__value")?.textContent,
    ]);
    expect(cells).toEqual([
      ["Channel", "Slack"],
      ["Label", "one of 2"],
    ]);
  });

  it("clicking a chip's × calls that chip's onRemove", () => {
    const channel = vi.fn();
    const labels = vi.fn();
    render(
      <FilterChipBar
        chips={[
          { id: "channel", field: "Channel", value: "Slack", onRemove: channel },
          { id: "labels", field: "Label", value: "one of 2", onRemove: labels },
        ]}
      />,
    );

    // Two chips means two x buttons — their accessible names have to differ by field for either
    // to be selectable.
    fireEvent.click(screen.getByRole("button", { name: "Remove Channel filter" }));
    expect(channel).toHaveBeenCalledOnce();
    expect(labels).not.toHaveBeenCalled();
  });

  it("the add trigger opens a popover listing all options, and toggling keeps it open", () => {
    const onToggle = vi.fn();
    render(<FilterChipBar chips={[]} addOptions={addOptions({ onToggle })} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Label filter" }));

    const popover = screen.getByRole("dialog");
    // The placeholder inherits the field name rather than hardcoding one, so the popover always
    // says which field it is searching.
    expect(within(popover).getByPlaceholderText("Search Label")).toBeInTheDocument();
    expect(within(popover).getByText("Integrations")).toBeInTheDocument();
    expect(within(popover).getByText("Billing")).toBeInTheDocument();

    // Multi-select: the list has to survive the first pick for a second to be possible.
    fireEvent.click(within(popover).getByText("Integrations"));
    expect(onToggle).toHaveBeenCalledWith("l1");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
  });

  // The reference's filter-popover input puts a magnifier at the far left with one hairline
  // underneath separating it from the list. Without that chrome the placeholder floats bare over
  // the list and stops reading as a field.
  //
  // Where the glyph comes from is part of it. This was the one `react-icons/lu` import left in
  // packages/ui, and a second icon set in one bundle draws a different stroke weight at the same
  // 14px, beside lucide glyphs in the rail, the palette and the ask panel. The assertion is on
  // lucide's own class rather than "an svg is in there" — the latter is what let the wrong set sit
  // here, since every icon passes it.
  it("gives the popover input a lucide search glyph and a rule above the list", () => {
    render(<FilterChipBar chips={[]} addOptions={addOptions()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Label filter" }));

    const search = screen.getByRole("dialog").querySelector(".filter-chip-popover__search");
    expect(search).not.toBeNull();
    expect(search?.querySelector("svg.lucide-search")).not.toBeNull();
    expect(search?.contains(screen.getByPlaceholderText("Search Label"))).toBe(true);
  });

  it("shows the ✓ only on the selected options", () => {
    render(<FilterChipBar chips={[]} addOptions={addOptions({ selectedIds: ["l1"] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Label filter" }));

    const popover = screen.getByRole("dialog");
    expect(within(popover).getByText("Integrations").previousSibling).toHaveTextContent("✓");
    expect(within(popover).getByText("Billing").previousSibling).toHaveTextContent("");
  });

  it("renders no add trigger when addOptions is omitted", () => {
    render(<FilterChipBar chips={[]} />);
    expect(screen.queryByRole("button", { name: "Add Label filter" })).not.toBeInTheDocument();
  });
});

describe("FilterChipBar responsive contract (US-D02b)", () => {
  // The bar is a single horizontal strip, never a wrapping pile — app.css holds `.filter-chip-bar`
  // on `flex-wrap: nowrap` and lets its host scroll it sideways instead. JSDOM computes no layout
  // and evaluates no `@container`, so the class hook plus the DOM shape below is everything this
  // level can honestly assert; the real 390/768/1024/1440px geometry is asserted in
  // tools/e2e/shots-responsive.ts (no horizontal overflow, filter row <= 40px tall).
  it("keeps every chip and the add trigger as children of one strip element", () => {
    const { container } = render(
      <FilterChipBar
        chips={[{ id: "labels", field: "Label", value: "one of 2", onRemove: vi.fn() }]}
        addOptions={addOptions()}
      />,
    );

    // One strip: the chip and the trigger side by side, nothing wrapping them in an extra row.
    expect(
      [...(container.querySelector(".filter-chip-bar")?.children ?? [])].map((c) => c.className),
    ).toEqual(["filter-chip", "filter-chip-bar__add"]);
  });

  // Below a 560px list pane app.css hides `.filter-chip-bar__add-label` and leaves the "+" — the
  // collapse is display:none, which JSDOM cannot apply. So what is locked here is that both halves
  // stay in the DOM and the button keeps a name that does not depend on either being visible.
  it("keeps the + glyph and the field label in the DOM under one stable accessible name", () => {
    render(<FilterChipBar chips={[]} addOptions={addOptions()} />);

    const add = screen.getByRole("button", { name: "Add Label filter" });
    // The name comes from aria-label, not from the text that the container query hides.
    expect(add).toHaveAttribute("aria-label", "Add Label filter");
    expect(add).toHaveAttribute("title", "Label");
    expect(add.querySelector(".filter-chip-bar__add-label")).toHaveTextContent("Label");
    // The "+" is decoration once the label is there — it must not join the accessible name.
    expect(within(add).getByText("+")).toHaveAttribute("aria-hidden", "true");
  });
});
