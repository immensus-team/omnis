import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// packages/ui/test/setup.ts와 동일한 이유(vitest.config.ts에 globals:true가 없어 RTL의
// 자동 afterEach(cleanup) 감지가 동작하지 않는다) — 명시적으로 cleanup한다.
afterEach(() => {
  cleanup();
});
