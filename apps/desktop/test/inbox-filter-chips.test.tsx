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
      unread_count: 0,
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

const { Inbox } = await import("../src/screens/Inbox");

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
  // (1) The five view pills are ~19px tall, under half the touch floor, while being this tier's
  // primary control; that is the list pane's own width, so it lives in the `list` query with the
  // icon collapse. (2) The hover-only Archive/Restore button is `opacity: 0`, so it keeps its box
  // — ~65px of every row's right column for a control a finger cannot reveal at all. That one is
  // the *shell* tier: at 768px the list pane is still ~736px wide, so the `list` query never fires
  // there even though the rail has already collapsed to a bottom bar. (3) The ask pill's grid
  // column needs its min-content released, and its orb dropped at phone widths, or the placeholder
  // ellipsizes and the strip can push the page wider.
  it("keeps the container queries that raise the pill targets and drop the row action", () => {
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    const ruleBlock = (query: string): string | undefined =>
      css.match(new RegExp(`@container ${query} \\{([\\s\\S]*?)\\n\\}`))?.[1];

    const narrowList = ruleBlock("list \\(max-width: 559\\.98px\\)");
    expect(narrowList).toBeDefined();
    expect(narrowList).toMatch(/\.inbox-card__pills button,[\s\S]*?min-height: 32px;/);

    const narrowShell = ruleBlock("shell \\(max-width: 899\\.98px\\)");
    expect(narrowShell).toBeDefined();
    expect(narrowShell).toMatch(/\.inbox-row__action \{\s*display: none;/);
    // Not global: the wide tier still reveals the action on `:focus-within` for the keyboard.
    expect(css).toContain(".inbox-row:focus-within .inbox-row__action");

    const phoneShell = ruleBlock("shell \\(max-width: 419\\.98px\\)");
    expect(phoneShell).toBeDefined();
    expect(phoneShell).toMatch(/\.ask-bar__orb \{\s*display: none;/);
    // The orb is the only child that carries no information — the controls stay.
    expect(phoneShell).not.toContain("ask-bar__composer-button");
    expect(css).toMatch(/\.ask-bar,\s*\n\.ask-bar__pill \{\s*\n\s*min-width: 0;/);
  });

  // Below a 560px list pane the container query hides `.inbox-card__archived-label` and shows the
  // archive glyph in its place. JSDOM cannot apply `@container`, so both halves are asserted to be
  // in the DOM at all times — and the toggle's name to come from aria-label, never from the text
  // that a real browser hides.
  it("keeps the archived toggle's glyph and label in the DOM under one stable accessible name", () => {
    renderInbox();

    const toggle = screen.getByRole("button", { name: "Archived" });
    expect(toggle).toHaveAttribute("aria-label", "Archived");
    expect(toggle).toHaveAttribute("title", "Archived");
    expect(toggle.querySelector(".inbox-card__archived-label")).toHaveTextContent("Archived");
    // The glyph is what survives the collapse, so it must not join the accessible name.
    expect(toggle.querySelector(".inbox-card__archived-icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});
