// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts,
// so the file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KeyValueTable } from "../src/components/key-value-table.js";

describe("KeyValueTable (US-D03: the reference's hairline key-value block)", () => {
  it("renders each row as a label/value pair", () => {
    render(
      <KeyValueTable
        rows={[
          { label: "Type", value: "B3 (Building Converted from One Family)" },
          { label: "Built", value: "1986" },
        ]}
      />,
    );
    const table = screen.getAllByRole("definition")[0]?.closest("dl");
    expect(table).not.toBeNull();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Built")).toBeInTheDocument();
    expect(screen.getByText("1986")).toBeInTheDocument();
  });

  it("marks a numeric row so times and counts get tabular figures", () => {
    render(
      <KeyValueTable
        rows={[
          { label: "Last contact", value: "3m", numeric: true },
          { label: "Channels", value: "Slack" },
        ]}
      />,
    );
    const rows = screen.getAllByRole("definition").map((dd) => dd.parentElement);
    // The styling hook is an attribute, not a class the caller can drift from — a numeric row
    // carries it and a text row does not.
    expect(rows[0]).toHaveAttribute("data-numeric", "true");
    expect(rows[1]).not.toHaveAttribute("data-numeric");
  });

  it("renders nothing at all when there are no rows", () => {
    // An empty <dl> would draw its top hairline and nothing else — a rule with no content under it.
    const { container } = render(<KeyValueTable rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
