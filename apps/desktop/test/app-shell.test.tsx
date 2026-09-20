// @vitest-environment jsdom
// 루트 `pnpm test`는 apps/desktop/vitest.config.ts를 읽지 않는다(packages/ui의 테스트들과 같은 사정) —
// 환경과 셋업을 파일 자체가 선언한다.
import "./setup";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** 이 테스트 파일이 놓인 디렉터리. import.meta.url은 vitest가 모듈을 변환하면서 file: 스킴이
 *  아닌 URL로 바뀔 수 있어(fileURLToPath가 "The URL must be of scheme file"로 죽는다) pathname만
 *  꺼내 쓴다 — cwd에 기대지 않으므로 루트 `pnpm test`에서도 `--filter @omnis/desktop`에서도 같다. */
const TEST_DIR = dirname(new URL(import.meta.url).pathname);

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
    expect(screen.getByRole("radiogroup", { name: "Inbox filters" })).toBeInTheDocument();
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

describe("App shell responsive contract (US-D02b)", () => {
  // 좁은 셸의 브레이크포인트는 CSS 컨테이너 쿼리와 channel-rail.tsx의 matchMedia가 **둘 다**
  // 들고 있다 — React는 컨테이너 쿼리 결과를 읽을 수 없어서 하나로 합칠 수가 없다. 한쪽만 고치면
  // 레일이 잘못된 티어를 그리는데(하단 바인데 타일 6개, 혹은 그 반대) 화면은 멀쩡해 보인다.
  // 그 어긋남을 여기서 막는다: app.css를 고칠 땐 channel-rail.tsx의 NARROW_RAIL_QUERY도 같이.
  it("uses the same narrow-rail breakpoint in app.css and channel-rail.tsx", () => {
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    const tsx = readFileSync(
      join(TEST_DIR, "../../../packages/ui/src/components/channel-rail.tsx"),
      "utf8",
    );
    // TS가 단언하는 컷을 CSS에서 찾는다. 반대 방향도 같이 막힌다 — 한쪽만 고치면 CSS에 그
    // 문자열이 없어져 여기서 걸린다(컷이 여러 개라 "가장 좁은 것"을 고르는 방식은 더 좁은 컷이
    // 하나 생기는 순간 엉뚱한 값을 집는다).
    const fromTsx = tsx.match(/NARROW_RAIL_QUERY = "\(max-width: ([\d.]+)px\)"/)?.[1];

    expect(fromTsx).toBeDefined();
    expect(css).toContain(`@container shell (max-width: ${fromTsx}px)`);
  });
});
