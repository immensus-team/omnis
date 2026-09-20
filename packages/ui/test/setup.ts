import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// deviation: plan's vitest.config.ts has no `globals: true`, so RTL's automatic
// afterEach(cleanup) detection never fires and DOM leaks across tests in the same
// file (button.test.tsx's 2 tests both rendered a <button>). Explicit cleanup instead
// of adding globals:true — smaller blast radius, doesn't change other test files' semantics.
afterEach(() => {
  cleanup();
});
