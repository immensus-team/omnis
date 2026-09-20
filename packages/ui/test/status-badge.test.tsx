// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts,
// so the file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "../src/components/status-badge";

describe("StatusBadge (the seven values of the A3 items.status enum)", () => {
  it.each([
    ["received", "Received"],
    ["read", "Read"],
    ["draft", "Draft"],
    ["approved", "Approved"],
    ["sent", "Sent"],
    ["failed", "Failed"],
    ["archived", "Archived"],
  ] as const)("%s → %s", (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toHaveAttribute("data-status", status);
  });
});
