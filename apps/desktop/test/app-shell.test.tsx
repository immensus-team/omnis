// @vitest-environment jsdom
// 루트 `pnpm test`는 apps/desktop/vitest.config.ts를 읽지 않는다(packages/ui의 테스트들과 같은 사정) —
// 환경과 셋업을 파일 자체가 선언한다.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// 이 테스트는 "화면이 셸에 실제로 붙어 있는가"만 본다. Zero 왕복은 tools/e2e(Playwright)가 본다.
const chain: unknown = new Proxy(() => chain, {
  get: () => chain,
  apply: () => chain,
});
vi.mock("../src/zero-client.js", () => ({
  initZero: () => chain,
  useZeroClient: () => chain,
  loadZeroToken: async () => {},
}));
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: () => [[], { type: "complete" }],
  useZero: () => chain,
  ZeroProvider: ({ children }: { children: unknown }) => children,
}));

// jsdom에는 ResizeObserver도 Element.scrollIntoView도 없다 — cmdk(Command.List)가 마운트
// 이펙트에서 둘 다 바로 쓴다. 실제 브라우저 동작은 tools/e2e의 Playwright가 본다.
Element.prototype.scrollIntoView ??= () => {};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { App } = await import("../src/App");

describe("App shell (US-A25 '빈 셸' + A26~A31 화면 라우팅)", () => {
  it("mounts the Inbox screen", () => {
    render(<App />);
    expect(screen.getByRole("radiogroup", { name: "Inbox 필터" })).toBeInTheDocument();
  });

  it("opens the ask panel on ⌘K (US-D01: 모달 팔레트가 아니라 인라인 ask 바의 AI 패널)", () => {
    render(<App />);
    expect(screen.queryByRole("dialog", { name: "AI 패널" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "AI 패널" })).toBeInTheDocument();
  });
});

describe("App shell 레이아웃 (U1 kinso: 레일 + 메인 컬럼)", () => {
  it("does not reserve a detail column while nothing is open", () => {
    // kinso 레퍼런스는 선택 전 Inbox 카드가 창 전체를 차지한다 — 빈 상세 패널이 폭을 먹으면 안 된다.
    render(<App />);
    expect(screen.queryByTestId("detail-pane")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-shell")).not.toHaveClass("app-shell--with-detail");
  });
});
