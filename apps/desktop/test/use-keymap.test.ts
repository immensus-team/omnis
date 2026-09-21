// @vitest-environment jsdom
// The bootstrap is imported rather than assumed: this file drives `useKeymap` through a real
// `keydown`, and RTL's `cleanup` (which the setup installs for the whole file) is what keeps one
// test's dialog out of the next one's document-wide `[aria-modal="true"]` scan.
import "./setup";

import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isEditableTarget,
  isInsideOverlay,
  reduceKeySequence,
  useKeymap,
} from "../src/hooks/use-keymap";

describe("reduceKeySequence (A5 §2.4 go-to prefix g+letter, 300ms window)", () => {
  it("g then i within 300ms resolves to 'go-inbox'", () => {
    const r1 = reduceKeySequence(null, "g", 1000);
    expect(r1.pending).toBe("g");
    const r2 = reduceKeySequence(r1, "i", 1100);
    expect(r2.resolved).toBe("go-inbox");
  });
  it("g then i after 300ms does not resolve (window expired)", () => {
    const r1 = reduceKeySequence(null, "g", 1000);
    const r2 = reduceKeySequence(r1, "i", 1500);
    expect(r2.resolved).toBeUndefined();
  });
  it("a single non-prefix key resolves directly (e.g. 'e' = archive)", () => {
    const r = reduceKeySequence(null, "e", 1000);
    expect(r.resolved).toBe("archive");
  });
});

describe("US-A36 archive keys", () => {
  it("'u' resolves to 'unarchive' (the undo of archive, 'e' in A5 §2.4's table)", () => {
    expect(reduceKeySequence(null, "u", 1000).resolved).toBe("unarchive");
  });

  it("ignores keys typed into the ask bar / Composer — an 'e' must not leak into archive", () => {
    const input = document.createElement("input");
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

// loop-r2-04: overlays own the keyboard. Every case below builds its own DOM and takes it down
// again — the `[aria-modal="true"]` half of the guard reads the whole document, so a dialog left
// behind by the test before would make the next one pass for the wrong reason.
/** Puts the fixture in the document — detached nodes do not bubble to `window`, where the keymap
 *  listens — and hands it back. */
function mount(html: string): HTMLElement {
  document.body.insertAdjacentHTML("beforeend", html);
  const last = document.body.lastElementChild;
  if (!(last instanceof HTMLElement)) throw new Error("nothing was mounted");
  return last;
}

/** The element a press would land on, wherever it is in the fixture. */
function press(root: HTMLElement): HTMLElement {
  const el = root.querySelector("[data-press]");
  if (!(el instanceof HTMLElement)) throw new Error("the fixture has no [data-press]");
  return el;
}

/** The thread sheet's own box below 900: a modal vaul drawer that is the document, not a layer. */
const THREAD_SHEET_FIXTURE =
  '<div data-vaul-drawer aria-modal="true" role="dialog" class="app-shell__detail">' +
  "<button data-press>Reply</button></div>";

afterEach(() => {
  document.body.replaceChildren();
});

describe("isInsideOverlay (loop-r2-04)", () => {
  it("is true for a press inside a role=dialog, an alertdialog and a vaul drawer", () => {
    for (const [open, close] of [
      ['<div role="dialog">', "</div>"],
      ['<div role="alertdialog">', "</div>"],
      ["<div data-vaul-drawer>", "</div>"],
    ] as const) {
      const pressed = press(mount(`${open}<button data-press>Archive</button>${close}`));
      expect(isInsideOverlay(pressed)).toBe(true);
      document.body.replaceChildren();
    }
  });

  it("is true when an [aria-modal=true] layer is up, wherever the focus happens to be", () => {
    mount('<div role="dialog" aria-modal="true"><button>Close</button></div>');
    expect(isInsideOverlay(document.body)).toBe(true);
  });

  it("is false with no overlay at all — the Inbox list is a listbox, and `j`/`k` belong to it", () => {
    expect(
      isInsideOverlay(press(mount('<div role="listbox"><div data-press>a row</div></div>'))),
    ).toBe(false);
    expect(isInsideOverlay(null)).toBe(false);
  });

  it("is false inside the thread sheet, which is a modal drawer and also the document being read", () => {
    expect(isInsideOverlay(press(mount(THREAD_SHEET_FIXTURE)))).toBe(false);
  });

  it("still blocks a layer opened on top of the thread sheet", () => {
    const sheet = mount(THREAD_SHEET_FIXTURE);
    mount('<div role="alertdialog" aria-modal="true"><button>Archive 3 threads?</button></div>');
    expect(isInsideOverlay(press(sheet))).toBe(true);
  });
});

// The guard only counts where it is wired: `useKeymap` is the one listener every keymap in the app
// goes through, so a real `keydown` is the shortest proof that a press in an overlay resolves to
// nothing rather than to the action the same letter resolves to outside it.
describe("useKeymap stands down inside an overlay (loop-r2-04)", () => {
  it("resolves nothing for `e` with focus on a button inside a role=dialog element", () => {
    const onResolve = vi.fn();
    renderHook(() => useKeymap(onResolve));
    fireEvent.keyDown(
      press(mount('<div role="dialog"><button data-press>Suggestions</button></div>')),
      {
        key: "e",
      },
    );
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("resolves nothing for `j` while an [aria-modal=true] element is in the document", () => {
    const onResolve = vi.fn();
    renderHook(() => useKeymap(onResolve));
    mount('<div role="dialog" aria-modal="true"><button>Close</button></div>');
    fireEvent.keyDown(document.body, { key: "j" });
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("still resolves `archive` for `e` with no overlay, and inside the thread sheet", () => {
    const onResolve = vi.fn();
    renderHook(() => useKeymap(onResolve));
    fireEvent.keyDown(press(mount("<div><button data-press>a row</button></div>")), { key: "e" });
    expect(onResolve).toHaveBeenCalledWith("archive");
    document.body.replaceChildren();

    fireEvent.keyDown(press(mount(THREAD_SHEET_FIXTURE)), { key: "e" });
    expect(onResolve).toHaveBeenCalledTimes(2);
    expect(onResolve).toHaveBeenLastCalledWith("archive");
  });
});
