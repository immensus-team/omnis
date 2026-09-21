// @vitest-environment jsdom
// loop-r2-03: the inline reply composer. The geometry (the 3-row min / 12-row max editor, the 12px
// hint) is asserted against app.css by apps/desktop/test/app-shell.test.tsx; this file drives what
// the component itself has to be true — it says where the reply goes, it proposes rather than sends,
// and it never loses the person's sentence to a failed request.
//
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReplyComposer } from "../src/components/reply-composer.js";

const BODY = "I'll send comments Wednesday.";

/** The defaults every test would otherwise repeat. `onSubmit` resolves; the failure case overrides. */
function composer(over: Partial<Parameters<typeof ReplyComposer>[0]> = {}) {
  return render(
    <ReplyComposer
      destination="#omnis-launch"
      channel="slack"
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      onCancel={vi.fn()}
      autoFocus={false}
      {...over}
    />,
  );
}

function box(): HTMLTextAreaElement {
  return screen.getByLabelText("Reply") as HTMLTextAreaElement;
}

describe("ReplyComposer (loop-r2-03: `r` opens a box that proposes a send)", () => {
  // L2-01/NC2-03: the line is the whole point of the component — a reply that does not say where it
  // is going is the old button back. Same sentence as the approval card's header for a `send`, so the
  // box and the card it becomes name the destination identically.
  it("says where the reply goes, with the channel's own mark", () => {
    const { container } = composer();

    expect(screen.getByText("Reply in #omnis-launch · Slack")).toBeInTheDocument();
    // The brand mark is the real PNG at the line's own size, decoration only (§e guard 9).
    const mark = container.querySelector(".reply-composer__header img");
    expect(mark).toHaveAttribute("width", "14");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    // The box is content, not chrome: it stands on the opaque surface (v3 §e guard 4) and is never
    // glass — the same claim the approval card beside it makes.
    expect(container.querySelector(".reply-composer")).toHaveClass("opaque-surface");
  });

  it("drops the channel half rather than printing a hole", () => {
    composer({ channel: null });
    // An account whose channel this app has no mark for: the destination is still readable.
    expect(screen.getByText("Reply in #omnis-launch")).toBeInTheDocument();
    expect(document.querySelector(".reply-composer__header img")).toBeNull();
  });

  it("offers no send while there is nothing to send", () => {
    composer();
    const send = screen.getByRole("button", { name: "Send for approval" });
    expect(send).toBeDisabled();

    // Whitespace is not a reply, and the same trim is what the hub applies.
    fireEvent.change(box(), { target: { value: "   " } });
    expect(send).toBeDisabled();

    fireEvent.change(box(), { target: { value: BODY } });
    expect(send).toBeEnabled();
  });

  // Enter has to be able to break a line in a reply, so the send chord is the modified one, and the
  // component reads the same chord the hint prints.
  it("submits on ⌘Enter and Ctrl+Enter, and hands up the trimmed text", () => {
    const onMeta = vi.fn().mockResolvedValue(undefined);
    const { unmount } = composer({ onSubmit: onMeta });

    fireEvent.change(box(), { target: { value: `  ${BODY}  ` } });
    fireEvent.keyDown(box(), { key: "Enter", metaKey: true });
    // The hub trims too, so the string handed up is the one the approval row ends up holding.
    expect(onMeta).toHaveBeenCalledWith(BODY);

    // Plain Enter is a newline, which the browser owns — nothing is proposed.
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onMeta).toHaveBeenCalledOnce();
    unmount();

    // The chord is both modifiers everywhere it is read: Ctrl is what a non-Apple keyboard has.
    const onCtrl = vi.fn().mockResolvedValue(undefined);
    composer({ onSubmit: onCtrl });
    fireEvent.change(box(), { target: { value: BODY } });
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    expect(onCtrl).toHaveBeenCalledWith(BODY);
  });

  it("shows the chord it reads, and says what it is doing while it does it", async () => {
    let land!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        }),
    );
    composer({ onSubmit });

    expect(document.querySelector(".reply-composer__hint")).toHaveTextContent("to send");

    fireEvent.change(box(), { target: { value: BODY } });
    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));
    // A second press while the first is in flight is the same proposal twice.
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    fireEvent.keyDown(box(), { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledOnce();

    land();
    expect(await screen.findByRole("button", { name: "Send for approval" })).toBeEnabled();
  });

  // Escape belongs to the box: the pane behind it must not also close, or the conversation the person
  // was reading goes with the box they cancelled.
  it("keeps Escape in the box, and only asks about text that would be lost", () => {
    const onCancel = vi.fn();
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    composer({ onCancel });

    // Blank box: nothing to lose, so the press cancels outright.
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKey);
  });

  it("asks before throwing away a written reply", () => {
    const onCancel = vi.fn();
    composer({ onCancel });
    fireEvent.change(box(), { target: { value: BODY } });

    fireEvent.keyDown(box(), { key: "Escape" });
    const prompt = screen.getByRole("alertdialog", { name: "Discard this reply?" });
    // Asking is not deciding: the sentence is still in the box behind the prompt.
    expect(onCancel).not.toHaveBeenCalled();
    expect(box()).toHaveValue(BODY);

    fireEvent.click(prompt.querySelector("[data-destructive]") as HTMLElement);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  // The one thing this screen must not do is lose the sentence to a failed request. The box is local
  // state and the component is still mounted, which is exactly the state a retry needs.
  it("keeps the text and says so when the proposal fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("HTTP 500"));
    composer({ onSubmit });

    fireEvent.change(box(), { target: { value: BODY } });
    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't send for approval. Try again.",
    );
    expect(box()).toHaveValue(BODY);
    expect(screen.getByRole("button", { name: "Send for approval" })).toBeEnabled();
  });

  it("cancels from the button too, whatever is in the box", () => {
    // Cancel is the explicit gesture, so it is not the one that asks — the confirm belongs to the
    // accidental Escape, which is a key the person may not know the box owns.
    const onCancel = vi.fn();
    composer({ onCancel });
    fireEvent.change(box(), { target: { value: BODY } });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("puts the caret in the box when it opens itself", () => {
    composer({ autoFocus: true });
    expect(box()).toHaveFocus();
  });
});
