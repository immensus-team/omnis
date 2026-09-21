// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster, toast } from "../src/components/toast";

// motion-OSS S6. The surface under test is the design system's, not the screen's: the screen's job
// (which archive action raises which words, and that a bulk archive raises ONE toast rather than one
// per row — `archiveWithUndo` takes a list for exactly that) is Inbox.tsx's. The contract worth
// pinning here is that the host renders what it is given, with the class names app.css styles against
// the tokens, and that the action button is a real control wired to the handler it was handed.

afterEach(() => {
  // Sonner portals its list to document.body and keeps the pending toasts in module state, so
  // `cleanup()` — which unmounts RTL's own container — does not take a toast with it. Without this,
  // every test in this file reads the previous test's toasts too: the first run of this file failed
  // on "Found multiple elements with the role button and name Undo", which was one Undo from the
  // test before. Dismissing first clears sonner's state, then the portal's leftover nodes go.
  act(() => {
    toast.dismiss();
  });
  cleanup();
  for (const el of document.querySelectorAll('section[aria-label^="Notifications"]')) {
    el.remove();
  }
});

describe("Toaster (motion-OSS S6: the app's first toast)", () => {
  it("renders a raised toast and runs the action it was given", async () => {
    const onUndo = vi.fn();
    render(<Toaster />);

    act(() => {
      toast("Archived", { action: { label: "Undo", onClick: onUndo } });
    });

    // The words the user reads, and the way back.
    expect(await screen.findByText("Archived")).toBeInTheDocument();
    const undo = screen.getByRole("button", { name: "Undo" });
    undo.click();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("marks the toast and its action with the classes app.css styles against the tokens", async () => {
    render(<Toaster />);
    act(() => {
      toast("Restored", { action: { label: "Undo", onClick: vi.fn() } });
    });

    // `omnis-toast` / `omnis-toast__action` are the hooks the token styling hangs off. Renaming one
    // without the other leaves the toast unstyled in the app and every test still green, so the
    // pairing is pinned here, on the element sonner renders.
    //
    // What this file cannot check is whether those classes *win*: app.css's rules and sonner's are
    // both just text to jsdom, which applies neither. That check is in the browser, at
    // `tools/e2e/shots-motion-oss.ts` — its leave sequences read the Undo's computed background and
    // fail unless it is `--accent`. The first version of these class rules was (0,1,0) against
    // sonner's (0,2,0) and (0,3,0), i.e. dead declarations, and it was that assertion, not this
    // test, that caught it.
    const text = await screen.findByText("Restored");
    expect(text.closest(".omnis-toast")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveClass("omnis-toast__action");
  });

  it("composes a caller's class names with the ones app.css styles, rather than replacing them", async () => {
    // The alternative — letting the caller's object spread over ours — is a one-character diff and
    // looks equivalent, but it means a call site that wants a wider toast silently loses the token
    // styling the moment it passes `classNames.toast`. This pins the composition.
    render(
      <Toaster
        toastOptions={{
          classNames: { toast: "wider-toast", actionButton: "bigger-action" },
        }}
      />,
    );
    act(() => {
      toast("Restored", { action: { label: "Undo", onClick: vi.fn() } });
    });

    const text = await screen.findByText("Restored");
    expect(text.closest(".omnis-toast")).toHaveClass("wider-toast");
    expect(screen.getByRole("button", { name: "Undo" })).toHaveClass(
      "omnis-toast__action",
      "bigger-action",
    );
  });
});
