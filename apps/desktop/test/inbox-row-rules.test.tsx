// US-D08 §c.4: the row's hairline, its unread gutter and the avatar shapes. Nothing here renders —
// every assertion is against the two stylesheets as text, because the properties at stake
// (`::after` geometry, a container query's override) are ones jsdom neither lays out nor computes,
// and a DOM render would only prove the class is spelled the same on both sides.
//
// What this file *can* honestly do is catch the drift that has no other witness: the hairline's
// inset and the row's grid columns are two statements of one number, and the day they disagree the
// rule starts inside the avatar with nothing failing anywhere.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(new URL(import.meta.url).pathname);
const appCss = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
const tokensCss = readFileSync(join(TEST_DIR, "../../../packages/ui/src/tokens.css"), "utf8");

/** The declarations between a selector and its closing brace, for a flat rule. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

/** The body of a `@container <query> { … }` block. The query is a regex source, and the block ends
 *  at the first line-start `}` — no nested blocks in either of the ones read here. */
function containerBlock(query: string): string {
  const match = appCss.match(new RegExp(`@container ${query} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`@container block not found: ${query}`);
  return match[1];
}

describe("Inbox row hairline (US-D08 §c.4)", () => {
  // The rule is a pseudo-element, not a border: a border is full-bleed by construction and would
  // also join the row's box, which the archive collapse measures.
  it("draws the rule as a 1px pseudo-element inset from the text column", () => {
    const rule = ruleBody(appCss, ".inbox-row::after");
    expect(rule).toContain("height: 1px");
    expect(rule).toContain("left: var(--row-rule-inset)");
    expect(rule).toContain("bottom: 0");
    // Out of flow, or the pseudo-element would be laid out as a grid item and take a cell.
    expect(rule).toContain("position: absolute");
    // A rule that eats the row's own click is a 1px dead strip at the bottom of every row.
    expect(rule).toContain("pointer-events: none");
  });

  // The reviewer's check: ink at or under 8% alpha. Read off the declaration because that is the
  // same value `getComputedStyle(row, "::after").background` resolves to in a real browser.
  it("keeps the ink at or under 8% alpha", () => {
    const ink = /background:\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)\)/.exec(
      ruleBody(appCss, ".inbox-row::after"),
    );
    expect(ink).not.toBeNull();
    expect(Number(ink?.[4])).toBeLessThanOrEqual(0.08);
  });

  // Two statements of one number: the grid puts the text column at --row-rule-inset, and the rule
  // starts there. Derived rather than restated, so moving any of the four grid numbers without
  // moving the token fails here — which is the failure that would otherwise be found by eye, in a
  // screenshot, three slices later.
  it("derives --row-rule-inset from the row's own grid arithmetic", () => {
    const columns = /grid-template-columns:\s*([^;]+);/.exec(ruleBody(appCss, ".inbox-row"))?.[1];
    expect(columns?.trim()).toBe("10px 40px minmax(0, 1fr) auto");

    const gap = Number(
      /column-gap:\s*(\d+)px/.exec(ruleBody(appCss, ".inbox-row"))?.[1] ?? Number.NaN,
    );
    const [gutter, avatar] = (columns ?? "").split(/\s+/).map((c) => Number.parseFloat(c));
    const padding = Number(
      /padding:\s*var\(--row-pad-y\)\s+(\d+)px/.exec(ruleBody(appCss, ".inbox-row"))?.[1] ??
        Number.NaN,
    );
    // 16 padding + 10 gutter + 12 gap + 40 avatar + 12 gap.
    const expected = padding + gutter + gap + avatar + gap;

    const token = /--row-rule-inset:\s*(\d+)px;/.exec(tokensCss)?.[1];
    expect(Number(token)).toBe(expected);
  });

  // §c.4 asks for `:last-child::after { display: none }`. That selector cannot be used here:
  // Virtuoso wraps each item in its own `<div data-index …>`, so every row is an only child and the
  // rule would delete every hairline in the list at once. The class is how the list says it
  // instead, and this is the assertion that keeps the selector from coming back.
  it("drops the rule on the last row by class, not by a :last-child selector", () => {
    expect(ruleBody(appCss, ".inbox-row--last::after")).toContain("display: none");
    // Anchored at a line start, which is where a rule's selector sits: the comment above the
    // `.inbox-row--last` rule names the selector on purpose, and naming it is not using it.
    expect(appCss).not.toMatch(/^\.inbox-row:last-child/m);
  });
});

describe("Inbox row gutter and avatar shapes (US-D08 §c.4)", () => {
  it("centres the 8px dot across both rows in the leading column", () => {
    const dot = ruleBody(appCss, ".inbox-row__unread-dot");
    expect(dot).toContain("grid-column: 1");
    expect(dot).toContain("grid-row: 1 / span 2");
    expect(dot).toContain("justify-self: center");
    expect(dot).toContain("width: 8px");
    expect(dot).toContain("background: var(--accent)");
  });

  // A runtime tile is a squircle and a person is a circle; that split is the whole rule.
  it("keeps the runtime tile a 10px squircle and people at 50%", () => {
    expect(ruleBody(appCss, ".inbox-row__avatar")).toContain("border-radius: 50%");
    expect(ruleBody(appCss, ".inbox-row__avatar--runtime")).toContain("border-radius: 10px");
  });

  // The text column is column 3 for both the meta line and the summary line; the avatar is 2 and
  // the right slot is 4. A child left on the old numbering lands on the avatar.
  it("moves every child onto the numbered columns the gutter made room for", () => {
    expect(ruleBody(appCss, ".inbox-row__avatar")).toContain("grid-column: 2");
    expect(ruleBody(appCss, ".inbox-row__meta")).toContain("grid-column: 3");
    expect(ruleBody(appCss, ".inbox-row__summary-line")).toContain("grid-column: 3");
    expect(ruleBody(appCss, ".inbox-row__side")).toContain("grid-column: 4");
  });
});

describe("Inbox row in the <900 tier (US-D08 §c.4)", () => {
  // Desktop elevates the selected row into a white card; under a floating bar that reads as two
  // stacked sheets, so this tier tints it in place. The hairline stays — it is the list's grammar,
  // not the selection's.
  it("flattens the selected row to a tint with no shadow and no radius", () => {
    const narrow = containerBlock("shell \\(max-width: 899\\.98px\\)");
    const selected =
      /\.inbox-row--selected,\s*\n\s*\.inbox-row--selected:hover \{([\s\S]*?)\n {2}\}/.exec(
        narrow,
      )?.[1];

    expect(selected).toBeDefined();
    expect(selected).toContain("background: var(--state-hover)");
    expect(selected).toContain("box-shadow: none");
    expect(selected).toContain("border-radius: 0");
    // The override must not reach for the pseudo-element — the rule survives the flattening.
    expect(selected).not.toContain("::after");
  });

  it("raises the row's type one step (§b.4)", () => {
    const narrow = containerBlock("shell \\(max-width: 899\\.98px\\)");
    expect(narrow).toMatch(/\.inbox-row__name \{\s*font-size: 16px;/);
    expect(narrow).toMatch(/\.inbox-row__timestamp \{\s*font-size: 13px;/);
    expect(narrow).toMatch(/\.inbox-row__summary \{\s*font-size: 14px;/);
  });
});
