// @vitest-environment jsdom
// US-D02: the label filter chip bar under the inbox header — picking two labels in the popover
// creates chips, the list keeps only threads carrying those labels, and a chip's x undoes it.
// It reuses archive-inbox.test.tsx's table-tagging mock (Inbox needs different rows per query).
import "./setup";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { describe, expect, it, vi } from "vitest";

/** This test file's own directory, taken from the module URL rather than cwd — the same resolution
 *  app-shell.test.tsx uses, so it works from both the root `pnpm test` and `--filter @omnis/desktop`. */
const TEST_DIR = dirname(new URL(import.meta.url).pathname);

const THREADS = {
  none: "11111111-1111-1111-1111-111111111111",
  integration: "22222222-2222-2222-2222-222222222222",
  billing: "33333333-3333-3333-3333-333333333333",
  both: "44444444-4444-4444-4444-444444444444",
} as const;

function item(threadId: string, title: string) {
  return {
    id: `item-${threadId}`,
    thread_id: threadId,
    account_id: "acct-1",
    status: "received",
    scope: "work",
    subject: null,
    body: `${title} body`,
    sent_at: Date.now(),
    author_person_id: null,
    author_agent_id: null,
    thread: {
      id: threadId,
      kind: "email",
      title,
      external_id: title,
      meta: {},
      // US-D08 §c.3: the header subline counts unread rows, so the fixture is unread by default —
      // a zero-count fixture would make the count segment's absence the only thing testable.
      unread_count: 1,
      archived_at: null,
    },
    author: null,
  };
}

const store: Record<string, unknown[]> = {
  items: [
    item(THREADS.none, "No labels"),
    item(THREADS.integration, "Integration thread"),
    item(THREADS.billing, "Billing thread"),
    item(THREADS.both, "Both labels"),
  ],
  accounts: [{ id: "acct-1", channel: "gmail" }],
  pending_approvals: [],
  labels: [
    { id: "l1", name: "Integrations", kind: "topic", color: null },
    { id: "l2", name: "Billing", kind: "topic", color: null },
  ],
  thread_labels: [
    { id: "tl-1", thread_id: THREADS.integration, label_id: "l1" },
    { id: "tl-2", thread_id: THREADS.billing, label_id: "l2" },
    { id: "tl-3", thread_id: THREADS.both, label_id: "l1" },
    { id: "tl-4", thread_id: THREADS.both, label_id: "l2" },
  ],
  agent_sessions: [],
  agent_runtimes: [],
};

/** zero.query.<table>....(chain) -> { __table }. Every chain method returns the proxy itself. */
function taggedQuery(table: string): unknown {
  const proxy: unknown = new Proxy(
    {},
    { get: (_t, prop) => (prop === "__table" ? table : () => proxy) },
  );
  return proxy;
}
const zero = { query: new Proxy({}, { get: (_t, table) => taggedQuery(String(table)) }) };

vi.mock("../src/zero-client.js", () => ({
  initZero: () => zero,
  useZeroClient: () => zero,
  loadZeroToken: async () => {},
}));
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: (q: { __table: string }) => [store[q.__table] ?? [], { type: "complete" }],
  useZero: () => zero,
  ZeroProvider: ({ children }: { children: unknown }) => children,
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// The cmdk list the chip popover opens calls scrollIntoView on its selected item at mount.
// packages/ui/test/setup.ts already fills that gap; apps/desktop/test/setup.ts does not (no test
// there had rendered cmdk until now) — so it is filled here only.
if (typeof Element.prototype.scrollIntoView === "undefined") {
  Element.prototype.scrollIntoView = () => {};
}

const { Inbox, FILTER_LABEL } = await import("../src/screens/Inbox");

vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({ ok: true, json: async () => ({}) })),
);

const renderInbox = (props: ComponentProps<typeof Inbox> = {}) =>
  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 72 }}>
      <Inbox {...props} />
    </VirtuosoMockContext.Provider>,
  );

/** Scrape row names by class — while the popover is open cmdk's items are role="option" too, so a
 *  role-based query would mix them in with the list rows. */
const rowNames = (): string[] =>
  [...document.querySelectorAll(".inbox-row__name")].map((el) => el.textContent ?? "");

/** A chip is a field cell plus a value cell (the reference's filter DSL) — never read as one
 *  run-together string. */
const chipCells = (): (string | null | undefined)[][] =>
  [...document.querySelectorAll(".filter-chip")].map((chip) => [
    chip.querySelector(".filter-chip__field")?.textContent,
    chip.querySelector(".filter-chip__value")?.textContent,
  ]);

const addTrigger = () => screen.getByRole("button", { name: "Add Label filter" });
const optionIn = (label: string) => within(screen.getByRole("dialog")).getByText(label);

describe("Inbox label filter chips (US-D02)", () => {
  it("keeps only threads carrying the chosen label, and the chip's x restores the full list", () => {
    renderInbox();
    expect(rowNames()).toEqual([
      "No labels",
      "Integration thread",
      "Billing thread",
      "Both labels",
    ]);

    fireEvent.click(addTrigger());
    fireEvent.click(optionIn("Integrations"));
    expect(rowNames()).toEqual(["Integration thread", "Both labels"]);
    // Multi-select — the list has to survive the first click for a second pick to be possible.
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(optionIn("Billing"));
    expect(rowNames()).toEqual(["Integration thread", "Billing thread", "Both labels"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Label filter" }));
    expect(rowNames()).toEqual([
      "No labels",
      "Integration thread",
      "Billing thread",
      "Both labels",
    ]);
  });

  // The reference collapses the quantifier when there is a single value ("Channel is Slack") —
  // "one of 1" is not something a person writes, so with one label the value cell holds just the
  // name, exactly as the channel chip does.
  it("names the label in the value cell for one, and counts them for more than one", () => {
    renderInbox();
    fireEvent.click(addTrigger());
    expect(document.querySelector(".filter-chip")).toBeNull();

    fireEvent.click(optionIn("Integrations"));
    expect(chipCells()).toEqual([["Label", "Integrations"]]);
    fireEvent.click(optionIn("Billing"));
    expect(chipCells()).toEqual([["Label", "one of 2"]]);
  });

  it("draws no bar at all when the workspace has no labels", () => {
    const saved = store.labels;
    store.labels = [];
    try {
      const { container } = renderInbox();
      expect(container.querySelector(".filter-chip-bar")).toBeNull();
    } finally {
      store.labels = saved;
    }
  });
});

describe("Inbox channel filter chips (US-D02)", () => {
  // The channel chip's x undoes the rail selection, which the shell (App.tsx) owns. With no rail
  // state here there is no callback, and without a callback there is no chip — an x that does
  // nothing is worse than no x at all.
  it("draws a chip when channelFilter and its callback are both present, and x returns null", () => {
    const onChannelFilterChange = vi.fn();
    renderInbox({ channelFilter: "gmail", onChannelFilterChange });

    expect(chipCells()).toEqual([["Channel", "Gmail"]]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Channel filter" }));
    expect(onChannelFilterChange).toHaveBeenCalledWith(null);
  });

  it("draws no chip without the callback, even with channelFilter set", () => {
    renderInbox({ channelFilter: "gmail" });
    expect(document.querySelector(".filter-chip")).toBeNull();
  });
});

describe("Inbox filter row responsive contract (US-D02b)", () => {
  // The pills, the archived toggle and the label chips are ONE horizontal strip, not three stacked
  // lines — three stacked lines is the bug this slice fixed. app.css holds the strip on
  // `flex-wrap: nowrap` + `overflow-x: auto`, so a narrow pane scrolls it sideways instead of
  // growing taller. JSDOM computes no layout, so the geometry itself (no page-level horizontal
  // overflow, strip <= 40px tall) is asserted for real in tools/e2e/shots-responsive.ts — what is
  // locked here is the class hook and the stylesheet rule behind it.
  it("puts the pills, the archived toggle and the chip bar in one strip", () => {
    const { container } = renderInbox();

    expect(
      [...(container.querySelector(".inbox-card__filter-row")?.children ?? [])].map(
        (child) => child.className,
      ),
    ).toEqual(["inbox-card__pills", "inbox-card__archived-pill", "filter-chip-bar"]);
  });

  // An active filter must never be the first thing to scroll off the right edge. Behind five
  // always-present view pills, the chip currently cutting the list down — and its x — left the
  // screen entirely at 390px. The order is DOM order, not CSS `order`, so focus order follows.
  it("moves an active label chip in front of the view pills", () => {
    const { container } = renderInbox();
    const classesInStrip = () =>
      [...(container.querySelector(".inbox-card__filter-row")?.children ?? [])].map(
        (child) => child.className,
      );

    expect(classesInStrip()).toEqual([
      "inbox-card__pills",
      "inbox-card__archived-pill",
      "filter-chip-bar",
    ]);

    fireEvent.click(addTrigger());
    fireEvent.click(optionIn("Integrations"));

    // Two bars, not one moved bar: the chips take the front, and the "+" trigger keeps the end so
    // its popover is never torn down and remounted in the middle of a multi-select.
    expect(classesInStrip()).toEqual([
      "filter-chip-bar",
      "inbox-card__pills",
      "inbox-card__archived-pill",
      "filter-chip-bar",
    ]);
    expect(chipCells()).toEqual([["Label", "Integrations"]]);
  });

  // The next three cases read app.css and assert on declarations. jsdom cannot lay anything out,
  // so they guard against the declaration being deleted and nothing more — a later override, a
  // renamed container or a specificity conflict all keep them green. The layout invariants
  // themselves (no horizontal overflow, a <= 40px strip, 32px targets, no dead gutter) are
  // measured in a real browser by tools/e2e/shots-responsive.ts. Their names say so.
  it("keeps the nowrap and overflow-x declarations on the strip and the chip bar", () => {
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    // Matches the rule that starts the line — `.inbox-card__filter-row .filter-chip-bar` (the
    // padding reset) and the `::-webkit-scrollbar` rule both have more after the selector.
    const ruleFor = (selector: string): string =>
      css.match(new RegExp(`\\n${selector} \\{([^}]*)\\}`))?.[1] ?? "";

    const filterRow = ruleFor("\\.inbox-card__filter-row");
    expect(filterRow).toContain("flex-wrap: nowrap");
    expect(filterRow).toContain("overflow-x: auto");
    // The same bar is used by other screens, which have no scrolling host — it must not wrap there
    // either, or the inbox's 3-line chip pile comes back through the shared component.
    expect(ruleFor("\\.filter-chip-bar")).toContain("flex-wrap: nowrap");

    // `overflow-x: auto` forces the computed `overflow-y` to `auto`, so the strip clips anything a
    // child paints outside its box. Vertical padding is what keeps a focus ring visible in there.
    expect(filterRow).toMatch(/padding: \d+px 16px \d+px/);
    expect(filterRow).not.toContain("padding: 0 16px");
  });

  // Keyboard focus used to be indistinguishable from hover in this strip: the chips swapped in
  // `--state-hover`, which is the hover value, and the pills and the Archived toggle had nothing
  // at all. A ring with an offset is the signal hover never uses.
  it("keeps one focus-ring rule in the stylesheet covering every control in the strip", () => {
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    const ring = css.match(/\.inbox-card__pills button:focus-visible,[\s\S]*?\{([\s\S]*?)\}/)?.[0];

    expect(ring).toBeDefined();
    for (const selector of [
      ".inbox-card__archived-pill:focus-visible",
      ".inbox-card__filter-row .filter-chip button:focus-visible",
      ".inbox-card__filter-row .filter-chip-bar__add:focus-visible",
    ]) {
      expect(ring).toContain(selector);
    }
    expect(ring).toContain("outline: 2px solid var(--accent)");
    expect(ring).toContain("outline-offset");
  });

  // The chips were `flex: 0 0 auto` next to the summary, so at 390px they took the whole line and
  // the AI summary — the row's reason to exist — collapsed to about two characters.
  it("keeps the 480px container query that clamps the summary and drops the row chips", () => {
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    const narrow = css.match(/@container list \(max-width: 479\.98px\) \{([\s\S]*?)\n\}/)?.[1];

    expect(narrow).toBeDefined();
    expect(narrow).toContain("-webkit-line-clamp: 1");
    expect(narrow).toMatch(/\.inbox-row__chips \{\s*display: none;/);
  });

  // Three rules for the touch layout, on two different containers, and none of them can be observed
  // in jsdom — so this case locks the declarations down and shots-responsive.ts measures them.
  // (1) US-D08 §c.3: below 560px of list pane every inactive chip folds to its icon and keeps a
  // 32px target; that is the list pane's own width, so it lives in the `list` query. (2) The row's
  // swipe lives in the *shell* tier: at 768px the list pane is still ~736px wide, so the `list`
  // query never fires there even though the rail has already collapsed to a bottom bar. (3) The ask
  // pill's grid column needs its min-content released, and its orb dropped at phone widths, or the
  // placeholder ellipsizes and the strip can push the page wider.
  it("keeps the container queries that fold the chip labels and give the row its swipe", () => {
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    const ruleBlock = (query: string): string | undefined =>
      css.match(new RegExp(`@container ${query} \\{([\\s\\S]*?)\\n\\}`))?.[1];

    const narrowList = ruleBlock("list \\(max-width: 559\\.98px\\)");
    expect(narrowList).toBeDefined();
    // Only the *unchecked* chip folds — the active chip is the strip's "you are here" and keeps its
    // word, so a rule without that qualifier would be the bug, not the fix.
    expect(narrowList).toMatch(
      /\.inbox-card__pills button\[aria-checked="false"\] \.inbox-card__chip-label \{\s*display: none;/,
    );
    // The declaration is read within the unchecked-chip rule rather than against the selector, so
    // the prose inside it stays free to explain the number without breaking the assertion.
    const iconOnly = narrowList?.match(
      /\.inbox-card__pills button\[aria-checked="false"\] \{([\s\S]*?)\n {2}\}/,
    )?.[1];
    expect(iconOnly).toContain("padding: 0 10px;");
    // The strip's height is fixed by `--chip-h` at the base rule now, so this block must not be
    // re-trimming the padding to make room for a target that is already the right size.
    expect(narrowList).not.toContain("min-height");

    const narrowShell = ruleBlock("shell \\(max-width: 899\\.98px\\)");
    expect(narrowShell).toBeDefined();
    // §c.4: this tier used to switch the hover-only Archive/Restore button off entirely, and this
    // assertion used to be what kept that rule honest. The swipe replaced it as the tier's way to
    // archive, so the pill is back — it is the non-gesture twin guard 11 asks for. Its geometry and
    // its invisible-at-rest state are in inbox-row-rules.test.tsx, next to the rest of the row.
    expect(narrowShell).toMatch(/\.inbox-row__swipe \{\s*\n\s*position: absolute;/);
    expect(narrowShell).not.toMatch(/^ {2}\.inbox-row__action \{/m);
    // Not global either way: the wide tier still reveals the control on `:focus-within` for the
    // keyboard, and now so does this one. US-D09 §c.7: the reveal moved from the pill to the
    // cluster when the row's `…` joined it there, so the selector this asserts changed with it —
    // the pill is still inside the cluster, and the pill is still what the keyboard reaches.
    expect(css).toContain(".inbox-row:focus-within .inbox-row__hover-actions");

    const phoneShell = ruleBlock("shell \\(max-width: 419\\.98px\\)");
    expect(phoneShell).toBeDefined();
    expect(phoneShell).toMatch(/\.ask-bar__orb \{\s*display: none;/);
    // The orb is the only child that carries no information — the controls stay.
    expect(phoneShell).not.toContain("ask-bar__composer-button");
    expect(css).toMatch(/\.ask-bar,\s*\n\.ask-bar__pill \{\s*\n\s*min-width: 0;/);
  });

  // US-D08 §c.3: the Archived toggle is a 32px circle with no text at any width, so its name can
  // only come from aria-label. Asserted with the text content empty, which is what makes that a
  // fact rather than a convention.
  it("keeps the archived toggle's name on an icon-only 32px button", () => {
    renderInbox();

    const toggle = screen.getByRole("button", { name: "Archived" });
    expect(toggle).toHaveAttribute("aria-label", "Archived");
    expect(toggle).toHaveAttribute("title", "Archived");
    expect(toggle.textContent).toBe("");
    // The glyph is all there is, so it must not join the accessible name.
    expect(toggle.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Inbox header and category chips (US-D08 §c.3)", () => {
  // The chip is icon + label, and the label is the accessible name stated on the button rather
  // than inherited from its contents. That is the whole reason the `<560` collapse is safe: below
  // 560px of list pane app.css hides `.inbox-card__chip-label` on every inactive chip, and a name
  // derived from the DOM would go with it. JSDOM applies no `@container`, so what is locked here is
  // that the name does not depend on any node being visible — the real fold is measured in
  // tools/e2e/shots-responsive.ts.
  it("names every chip from its label, with nothing visible required", () => {
    renderInbox();

    for (const [id, label] of Object.entries(FILTER_LABEL)) {
      const chip = screen.getByRole("radio", { name: label });
      expect(chip).toHaveAttribute("aria-label", label);
      // The icon is decoration; a screen reader that announced it would say "graphic, All".
      expect(chip.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      // Icon *and* label are both in the DOM at every width — the collapse is a CSS display, and a
      // chip that never rendered its word could not be un-collapsed by a wider pane.
      expect(chip.querySelector(".inbox-card__chip-label")).toHaveTextContent(label);
      expect(chip).toHaveAttribute("aria-checked", String(id === "all"));
    }
  });

  // The count badge is inside the needs-approval chip. It must not be in the accessible name: the
  // name is the chip's label, and "Needs approval 2" announces the queue twice.
  it("keeps the pending count out of the chip's accessible name", () => {
    store.pending_approvals = [
      { id: "ap-1", thread_id: THREADS.none, state: "pending", created_at: Date.now() },
      { id: "ap-2", thread_id: THREADS.both, state: "pending", created_at: Date.now() },
    ];
    try {
      // loop-r2-06: the badge is the shell's number, handed in as a prop; the rows below it are a
      // different question and no longer feed it.
      renderInbox({ pendingApprovals: 2 });
      const chip = screen.getByRole("radio", { name: "Needs approval" });
      expect(chip.querySelector(".inbox-card__pill-count")).toHaveTextContent("2");
    } finally {
      store.pending_approvals = [];
    }
  });

  // §c.3: `channel · Updated 3m · N unread`, dropping any segment with nothing to say. The join is
  // what guarantees a separator is never left without a segment after it.
  it("composes the subline from the segments that have something to say", () => {
    const { container } = renderInbox();
    // One account, so it is named; every row is unread, so the count is there; the rows are fresh,
    // so the clock reads "now". Matched loosely because the clock is read when the assertion runs,
    // not when the fixture was built.
    expect(container.querySelector(".inbox-card__subline")?.textContent).toMatch(
      /^Gmail · Updated \S+ · 4 unread$/,
    );

    // The count drops at zero rather than reading "0 unread" — and the join does not leave the
    // separator behind it.
    const saved = store.items;
    store.items = saved.map((row) => {
      const r = row as { thread: Record<string, unknown> };
      return { ...r, thread: { ...r.thread, unread_count: 0 } };
    });
    try {
      const { container: quiet } = renderInbox();
      expect(quiet.querySelector(".inbox-card__subline")?.textContent).toMatch(
        /^Gmail · Updated \S+$/,
      );
    } finally {
      store.items = saved;
    }
  });

  // With no account connected there is no channel to name, so the segment goes and the subline
  // starts at the clock — never at a leading separator.
  it("drops the channel segment rather than leading with a separator", () => {
    const saved = store.accounts;
    store.accounts = [];
    try {
      const { container } = renderInbox();
      const text = container.querySelector(".inbox-card__subline")?.textContent ?? "";
      expect(text.startsWith("Updated ")).toBe(true);
      expect(text).not.toContain("· ·");
      expect(text).not.toMatch(/^·/);
    } finally {
      store.accounts = saved;
    }
  });
});
