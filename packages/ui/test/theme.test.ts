// jsdom은 CSS 커스텀 프로퍼티 캐스케이드를 계산하지 않는다(getComputedStyle이 <style> 규칙을
// 실제로 적용하지 않음) — tokens.ts를 값으로 검증하는 tokens.test.ts와 같은 방식으로,
// tokens.css 원문을 읽어 ":root"(속성 없음)가 라이트 기본값을, ":root[data-theme=\"dark\"]"가
// 다크 값을 갖는지 텍스트로 검증한다. (환경은 패키지 vitest.config.ts 기본 jsdom 그대로 —
// setup.ts가 전역 setupFiles로 항상 실행되고 Element를 참조하므로 node로 바꾸면 깨진다.)
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/tokens.css"),
  "utf-8",
);

/** ":root {"(속성 셀렉터 없는 순수 :root) 블록만 뽑는다 — ":root[data-theme=...] {" 블록과
 *  분리해야 "기본값=라이트"를 확실히 확인할 수 있다. */
function rootDefaultBlock(source: string): string {
  const start = source.indexOf(":root {");
  const end = source.indexOf("\n}", start);
  return source.slice(start, end);
}

function themeBlock(source: string, theme: string): string {
  const marker = `:root[data-theme="${theme}"] {`;
  const start = source.indexOf(marker);
  const end = source.indexOf("\n}", start);
  return source.slice(start, end);
}

describe("U1 theme default = light (DESIGN-DIRECTION.md '라이트 테마 기본')", () => {
  it("the attribute-less :root block ships light values, not dark", () => {
    const block = rootDefaultBlock(css);
    expect(block).toContain("--bg-base: var(--gray-000)");
    expect(block).not.toContain("--bg-base: var(--gray-950)");
  });

  it('dark tokens are still available, gated behind data-theme="dark"', () => {
    const block = themeBlock(css, "dark");
    expect(block).toContain("--bg-base: var(--gray-950)");
  });

  it("there is no default (attribute-less) dark selector left over from the old A5 default", () => {
    expect(css).not.toContain(':root[data-theme="light"]');
  });
});

describe("U1 canvas backdrop actually renders (CSS 유효성)", () => {
  it("--canvas-grid holds only <image> layers — a position/size clause would void background-image", () => {
    // `background-image: linear-gradient(...) 0 0 / 32px 32px`는 문법 오류라 선언 전체가 버려진다
    // (실측: getComputedStyle(body).backgroundImage === "none"). 크기는 --canvas-grid-size로 분리한다.
    const block = rootDefaultBlock(css);
    const grid = block.slice(block.indexOf("--canvas-grid:"));
    const value = grid.slice(0, grid.indexOf(";"));
    // 괄호 안의 `/`는 oklch(... / alpha)라 정상 — 레이어 사이에 남은 `/`만이 size 절이다.
    let stripped = value;
    while (/\([^()]*\)/.test(stripped)) stripped = stripped.replace(/\([^()]*\)/g, "");
    expect(stripped).not.toMatch(/\//);
    expect(block).toContain("--canvas-grid-size:");
  });

  it("dark theme blanks both the layers and their sizes", () => {
    const block = themeBlock(css, "dark");
    expect(block).toContain("--canvas-grid: none");
    expect(block).toContain("--canvas-grid-size:");
  });
});
