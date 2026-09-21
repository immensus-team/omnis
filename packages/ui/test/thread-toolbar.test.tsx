// @vitest-environment jsdom
// US-D09 §c.5/§c.9: the toolbar. The geometry (40px capsule, 44px buttons in the narrow tier, where
// it is pinned) is asserted against app.css by apps/desktop/test/app-shell.test.tsx, because that is
// where the numbers live; this file drives what the component has to be true — glass, labelled
// buttons, and one more button that opens §c.7's menu.
//
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and setup are declared by the file itself.
import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { Archive, Reply } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { PHASE_B_TITLE } from "../src/components/channel-rail";
import { ThreadToolbar } from "../src/components/thread-toolbar";

const actions = [
  {
    id: "reply",
    label: "Reply",
    icon: Reply,
    onSelect: vi.fn(),
    disabled: true,
    title: PHASE_B_TITLE,
  },
  { id: "archive", label: "Archive thread", icon: Archive, onSelect: vi.fn() },
];

describe("ThreadToolbar (US-D09 §c.5 / §c.9)", () => {
  it("is the glass surface itself, and names the slot it is", () => {
    // Reviewer check 1: the action bar is `.glass-surface` and declares no background of its own —
    // the fill is tokens.css's recipe, which is what makes it the same material as the BottomBar's
    // circles beside it in the narrow tier.
    const { container } = render(<ThreadToolbar actions={actions} />);
    const bar = container.querySelector(".thread-toolbar");

    expect(bar).toHaveClass("glass-surface");
    expect(bar).toHaveAttribute("data-glass-slot", "toolbar");
  });

  it("gives every icon-only button a name, and the disabled one its reason", () => {
    render(<ThreadToolbar actions={actions} />);

    const reply = screen.getByRole("button", { name: "Reply" });
    expect(reply).toBeDisabled();
    // §e guard 9: the icon is decoration; the label is what a screen reader reads.
    expect(reply.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // A gated control says why rather than just refusing to respond.
    expect(reply).toHaveAttribute("title", PHASE_B_TITLE);

    const archive = screen.getByRole("button", { name: "Archive thread" });
    expect(archive).toBeEnabled();
    // No separate title given, so the tooltip is the name — stated once.
    expect(archive).toHaveAttribute("title", "Archive thread");
  });

  it("calls the action that was pressed, and only that one", () => {
    const onReply = vi.fn();
    const onArchive = vi.fn();
    render(
      <ThreadToolbar
        actions={[
          { id: "reply", label: "Reply", icon: Reply, onSelect: onReply },
          { id: "archive", label: "Archive thread", icon: Archive, onSelect: onArchive },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Archive thread" }));
    expect(onArchive).toHaveBeenCalledOnce();
    expect(onReply).not.toHaveBeenCalled();
  });

  it("draws the menu as one more button when it is given one, and none when it is not", () => {
    const { unmount } = render(
      <ThreadToolbar
        actions={actions}
        menu={{
          label: "Thread options",
          groups: [
            {
              items: [{ id: "labels", label: "Labels", icon: Archive, onSelect: vi.fn() }],
            },
          ],
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Thread options" });
    expect(trigger).toHaveClass("thread-toolbar__button");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    trigger.focus();
    fireEvent.click(trigger);
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText("Labels")).toBeInTheDocument();
    // The panel is portaled to the body, so the bar that opened it is not one of its ancestors —
    // which is what keeps a glass panel from ever being nested inside the glass bar.
    expect(panel.closest(".thread-toolbar")).toBeNull();

    unmount();
    render(<ThreadToolbar actions={actions} />);
    expect(screen.queryByRole("button", { name: "Thread options" })).not.toBeInTheDocument();
  });
});
