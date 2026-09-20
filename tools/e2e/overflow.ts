// The horizontal-overflow guard both shot scripts measure with.
//
// Why this is a shared module: the three call sites used to inline
// `documentElement.scrollWidth - documentElement.clientWidth` and drifted apart. When
// app.css carried `html, body { overflow-x: clip }`, that reading was pinned to 0 no matter
// what the page did — a browser probe with a 2000px child at a 390px viewport returned
// diff=1610 with no rule, diff=1610 with `html { overflow-x: clip }` alone, and diff=0 with
// the exact `html, body` pair the stylesheet had. Every "overflow 0px" citation built on it
// was vacuous. One implementation, measured off <body> (which the root rule could not pin),
// is what keeps that from coming back.
//
// Two readings, because each misses what the other catches:
//   1. `body.scrollWidth - clientWidth` — does the page itself scroll sideways?
//   2. an element scan — does anything *visible* lay out past the viewport without growing
//      scrollWidth? (absolutely positioned / fixed boxes do not contribute to their parent's
//      scrollWidth.)
// Reading 2 asks about visible overflow, so a *decorative* element that an ancestor clips
// horizontally is skipped: it is inside a box that ends at or before the viewport edge, so it can be
// reached neither by scrolling nor by the eye. US-D06's aurora layers are the worked example — §2.3
// bleeds each blurred layer `calc(-2 * blur)` outside its `.aurora` parent so no blurred edge lands
// inside the box, and `.aurora` clips it with `overflow: hidden` by design. Before that skip, a
// correctly clipped 64px-blur bleed reported `span.aurora__mass +128px` while reading 1 said `0px`
// in the same breath.
// Only decoration qualifies: `aria-hidden="true"` or `pointer-events: none` all the way up to the
// clipper. A clipped *content* box is still reported — a button cut off at the edge is a defect
// whether or not the page also scrolls, and skipping every clipped element would have swallowed
// that (the filter chip bar's add button is 18px past the edge at 414px and correctly stays
// reported). A clip at the *root* is not treated this way at all: `html, body { overflow-x: clip }`
// is exactly the page-wide suppression this module exists to see through (see above).
// What neither catches is overlap *inside* a clipped box, e.g. two grid items sharing a cell.
// shots.ts measures that directly (`.inbox-row__chips` vs `.inbox-row__side`); it is a
// different failure and needs a different probe.

export interface OverflowReport {
  /** `document.body.scrollWidth - documentElement.clientWidth`. Positive means the page scrolls
   *  sideways. Read off <body> on purpose — see the header note. */
  diff: number;
  /** The element reaching furthest past the viewport's right edge, or null if none does. */
  worst: { selector: string; over: number } | null;
}

/** Runs in the page. Self-contained on purpose: `page.evaluate` serializes the function source,
 *  so it cannot close over anything in this module.
 *
 *  No nested function expressions either — not a style choice. The scripts run through `tsx`,
 *  whose esbuild pass has `keepNames` on, and that rewrites a nested arrow into
 *  `__name(arrow, "arrow")`. The rewrite lands *inside* the source Playwright ships to the page,
 *  where `__name` does not exist, and the probe dies with `ReferenceError: __name is not defined`.
 *  Anything added to this body has to stay inline for the same reason. */
export function measureOverflow(): OverflowReport {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  let worst: OverflowReport["worst"] = null;

  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    const rect = el.getBoundingClientRect();
    // Skip zero-area boxes: they cannot overlap or push anything, and there are many of them.
    if (rect.width === 0 || rect.height === 0) continue;
    const over = rect.right - vw;
    if (over <= 0) continue;

    // An ancestor that scrolls or clips horizontally owns this element's right edge: a scroller is
    // allowed to hold content wider than itself (that is what scrolling means — the filter strip is
    // one), and a clipper hides the overflow — but only if what it hides is decoration. Everything
    // else that pokes past the viewport is a bug. A clip at the root does not count — see the
    // header. Both walks are inline: this body ships to the page as source (see below).
    let contained = false;
    for (let p = el.parentElement; p !== null && p !== doc; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll") {
        contained = true;
        break;
      }
      if (ox !== "hidden" && ox !== "clip") continue;
      contained = true;
      for (let q: Element | null = el; q !== null && q !== p; q = q.parentElement) {
        const cs = getComputedStyle(q);
        if (q.getAttribute("aria-hidden") !== "true" && cs.pointerEvents !== "none") {
          // Real content under a clipper: the page does not scroll, but something is cut off, and
          // that is the finding this scan exists for.
          contained = false;
          break;
        }
      }
      break;
    }
    if (contained) continue;

    if (worst === null || over > worst.over) {
      const first = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
      const parent = el.parentElement;
      const parentFirst =
        parent !== null && typeof parent.className === "string"
          ? parent.className.trim().split(/\s+/)[0]
          : "";
      // The parent is part of the selector because the element alone is often ambiguous — a failure
      // that says `span.aurora__mass +128px` does not say *which* aurora bled.
      const chain =
        parent === null || parent === document.documentElement || parent === document.body
          ? ""
          : `${parent.tagName.toLowerCase()}${parentFirst ? `.${parentFirst}` : ""} > `;
      worst = {
        selector: `${chain}${el.tagName.toLowerCase()}${first ? `.${first}` : ""}`,
        over: Math.round(over * 10) / 10,
      };
    }
  }

  return { diff: document.body.scrollWidth - vw, worst };
}

/** Throw if the page scrolls sideways or anything lays out past the viewport. `where` names the
 *  width (and pass) the measurement was taken at, so a failure says which screenshot to open. */
export function assertNoOverflow(where: string, report: OverflowReport): void {
  const at =
    report.worst === null
      ? ""
      : ` — widest element past the edge: ${report.worst.selector} +${report.worst.over}px`;
  if (report.diff > 0) {
    throw new Error(
      `horizontal overflow at ${where}: body is ${report.diff}px wider than the viewport${at}`,
    );
  }
  if (report.worst !== null) {
    throw new Error(
      `element laid out past the viewport at ${where}: ${report.worst.selector} +${report.worst.over}px`,
    );
  }
}

/** One log line per measurement, matching what the previous inline probes printed. */
export function describeOverflow(report: OverflowReport): string {
  const worst =
    report.worst === null ? "" : `, worst ${report.worst.selector} +${report.worst.over}px`;
  return `overflow ${report.diff}px${worst}`;
}
