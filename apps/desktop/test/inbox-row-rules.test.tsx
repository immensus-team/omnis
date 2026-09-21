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
    // US-D08 §c.4: the grid is on `.inbox-row__content` since the swipe — that wrapper is what
    // translates, and the padding and the hairline stayed on the row's own box. The arithmetic is
    // unchanged; only the rule it is read from moved.
    const grid = ruleBody(appCss, ".inbox-row__content");
    const columns = /grid-template-columns:\s*([^;]+);/.exec(grid)?.[1];
    expect(columns?.trim()).toBe("10px 40px minmax(0, 1fr) auto");

    const gap = Number(/column-gap:\s*(\d+)px/.exec(grid)?.[1] ?? Number.NaN);
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

describe("Inbox row hover cluster (US-D09 §c.7)", () => {
  // One reveal, on the cluster. `opacity` is not an inherited property, so the copy US-D02b left on
  // the pill did not go away when 7a02ecd moved the reveal up to the cluster: the cluster turned to
  // 1/auto and the pill stayed at 0/none inside it — a visible box that no click could land on.
  // Nothing in the unit suite could see that, but the browser could: phase A's A-archive waited its
  // whole 90s test budget for that click, and d9-surfaces.spec.ts now hit-tests the pill.
  it("leaves the reveal to the cluster, not to the pill inside it", () => {
    const cluster = ruleBody(appCss, ".inbox-row__hover-actions");
    // Out of flow (US-D02b: the row's `auto` column is sized by the brand mark alone) and off until
    // the row is pointed at or focused.
    expect(cluster).toContain("position: absolute");
    expect(cluster).toContain("opacity: 0");
    expect(cluster).toContain("pointer-events: none");

    const pill = ruleBody(appCss, ".inbox-row__action");
    expect(pill).not.toContain("opacity");
    expect(pill).not.toContain("pointer-events");

    // …and the reveal itself, on both halves of the pair.
    expect(appCss).toContain(".inbox-row:hover .inbox-row__hover-actions,");
    const revealed = ruleBody(appCss, ".inbox-row:focus-within .inbox-row__hover-actions");
    expect(revealed).toContain("opacity: 1");
    expect(revealed).toContain("pointer-events: auto");
  });
});

describe("Inbox row swipe (US-D08 §c.4)", () => {
  const tsx = readFileSync(
    join(TEST_DIR, "../../../packages/ui/src/components/inbox-row.tsx"),
    "utf8",
  );

  /** The declarations of one rule inside the `<900` block, where every rule is indented by two. */
  function narrowRuleBody(selector: string): string {
    const block = containerBlock("shell \\(max-width: 899\\.98px\\)");
    const start = block.indexOf(`\n  ${selector} {`);
    if (start === -1) throw new Error(`narrow rule not found: ${selector}`);
    return block.slice(start, block.indexOf("}", start));
  }

  // M167: a 56px circle with its caption under it. The caption is 11px because it is a label under
  // an icon, not a second line of row text.
  it("draws the revealed action as a 56px disc with an 11px caption under it", () => {
    expect(narrowRuleBody(".inbox-row__swipe-disc")).toContain("width: 56px");
    expect(narrowRuleBody(".inbox-row__swipe-disc")).toContain("height: 56px");
    // The one accent, on the action the swipe performs — the same pairing as the active chip.
    expect(narrowRuleBody(".inbox-row__swipe-disc")).toContain("background: var(--accent)");
    expect(narrowRuleBody(".inbox-row__swipe-caption")).toContain("font-size: 11px");
  });

  // The strip is under the content in paint order and the row has no opaque fill of its own to hide
  // it with, so what keeps it off the screen at rest is its own opacity — with pointer-events
  // riding along, or an invisible button would be the row's click target.
  it("keeps the strip invisible and unclickable until the content has moved", () => {
    const strip = narrowRuleBody(".inbox-row__swipe");
    expect(strip).toContain("opacity: 0");
    expect(strip).toContain("pointer-events: none");
    expect(strip).toContain("position: absolute");

    const revealed = narrowRuleBody(".inbox-row--revealed .inbox-row__swipe");
    expect(revealed).toContain("opacity: 1");
    expect(revealed).toContain("pointer-events: auto");
  });

  // Two statements of one number again, this time across a language: the row's travel is JS
  // (SWIPE_OPEN_PX) and the geometry it has to clear is CSS. The disc is anchored 16px in from the
  // row's padding box, so when the content has travelled T its right edge sits T px left of the
  // disc's right edge; clearing the disc and leaving Mail's 16px of air beside it needs T >= 56+16.
  // A wider disc with the travel left alone fails here instead of being found in a screenshot with
  // the button half under the text.
  it("gives the row enough travel to clear the disc and the air beside it", () => {
    const travel = Number(/const SWIPE_OPEN_PX = (\d+);/.exec(tsx)?.[1]);
    const disc = Number(
      /width:\s*(\d+)px/.exec(narrowRuleBody(".inbox-row__swipe-disc"))?.[1] ?? Number.NaN,
    );
    const inset = Number(
      /right:\s*(\d+)px/.exec(narrowRuleBody(".inbox-row__swipe"))?.[1] ?? Number.NaN,
    );

    expect(travel).toBeGreaterThanOrEqual(disc + inset);
  });

  // Three properties that make a horizontal gesture inside a vertical scroller possible at all:
  // the clip that keeps the translated content from widening the page, the touch-action that keeps
  // the browser's vertical scroll while giving up the horizontal pan, and the selection that would
  // otherwise happen at the same time as the drag.
  it("clips the travel, keeps the vertical scroll and cancels the selection", () => {
    expect(narrowRuleBody(".inbox-row")).toContain("overflow: hidden");
    expect(narrowRuleBody(".inbox-row")).toContain("touch-action: pan-y");
    expect(narrowRuleBody(".inbox-row__content")).toContain("user-select: none");
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
    // loop-r1-03: no radius in this tier either, but it is now said once. The row declares
    // --row-radius: 0 here and the selection, the hover fill and the focus ring all read it, so
    // "this tier's rows are square" is one statement rather than three that can drift apart.
    expect(selected).toContain("border-radius: var(--row-radius)");
    const row = /^ {2}\.inbox-row \{([\s\S]*?)^ {2}\}/m.exec(narrow)?.[1];
    expect(row).toContain("--row-radius: 0");
    // The override must not reach for the pseudo-element — the rule survives the flattening.
    expect(selected).not.toContain("::after");
  });

  // §c.4: the hover-only Archive pill used to be switched off in this tier, which the sweep in
  // shots-responsive.ts looked for. The swipe replaced it, so the pill is back — as the half of
  // guard 11 a gesture cannot be. Line-anchored so a comment that names the old rule is not read as
  // the rule itself.
  it("no longer hides the row's action button in this tier", () => {
    const narrow = containerBlock("shell \\(max-width: 899\\.98px\\)");
    expect(narrow).not.toMatch(/^ {2}\.inbox-row__action \{/m);
  });

  it("raises the row's type one step (§b.4)", () => {
    const narrow = containerBlock("shell \\(max-width: 899\\.98px\\)");
    expect(narrow).toMatch(/\.inbox-row__name \{\s*font-size: 16px;/);
    expect(narrow).toMatch(/\.inbox-row__timestamp \{\s*font-size: 13px;/);
    expect(narrow).toMatch(/\.inbox-row__summary \{\s*font-size: 14px;/);
  });
});

describe("Inbox row radius and focus ring (loop-r1-03/NC-28)", () => {
  // The row's corner is one number in three places — the selection card, the hover fill and the
  // focus ring. The ring is the reason it is a token at all: NC-28's square blue box ran past the
  // card's 8px corners because the ring did not know what shape the box under it was.
  it("gives the selected card, the hover fill and the ring one radius", () => {
    expect(ruleBody(appCss, ".inbox-row")).toContain("--row-radius: 8px");
    expect(ruleBody(appCss, ".inbox-row--selected")).toContain("border-radius: var(--row-radius)");
    expect(ruleBody(appCss, ".inbox-row:hover")).toContain("border-radius: var(--row-radius)");
  });

  // Read from the source rather than from a render: jsdom neither lays out nor paints an outline,
  // so a DOM assertion could only prove the selector matches something.
  it("insets the focus ring into the row's own corners", () => {
    const ring = ruleBody(appCss, '.inbox-row[role="option"]:focus-visible');
    expect(ring).toContain("outline: 2px solid var(--accent)");
    // Inside the row's box rather than growing it — this is the "bleeds past the corners" half.
    expect(ring).toContain("outline-offset: -2px");
    expect(ring).toContain("border-radius: var(--row-radius)");
    // One ring only (v3 §e.11): a shadow beside the outline is the second one, and it is what made
    // the row look focused and broken at the same time.
    expect(ring).not.toContain("box-shadow");
  });
});
