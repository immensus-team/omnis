import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals:true is not set (same as apps/desktop/tsconfig-less vitest.config.ts), so React Testing
// Library cannot install its own afterEach(cleanup) — do it by hand or a second render in the same
// file finds the first one's DOM still mounted.
afterEach(() => {
  cleanup();
});
