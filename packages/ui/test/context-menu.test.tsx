// @vitest-environment jsdom
// US-D09 §c.7: the contextual menu. The root `pnpm test` (vitest.workspace.ts) does not read
// packages/ui/vitest.config.ts, so the environment and the setup are declared by the file itself.
import "./setup";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Archive, Reply, Trash2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import type { ContextMenuGroup } from "../src/components/context-menu";
import { ContextMenu } from "../src/components/context-menu";

/** jsdom's `click` never focuses the element it fires on, and Radix restores focus on close to
 *  whatever was focused when the panel opened — so a real user's press has to be staged. */
function press(element: HTMLElement) {
  element.focus();
  fireEvent.click(element);
}

function menu(groups: ContextMenuGroup[]) {
  return render(
    <ContextMenu
      label="Thread actions"
      trigger={
        <button type="button" aria-label="More actions">
          …
        </button>
      }
      groups={groups}
    />,
  );
}

const archive = vi.fn();

function twoGroups(): ContextMenuGroup[] {
  return [
    {
      items: [{ id: "reply", label: "Reply", icon: Reply, onSelect: vi.fn() }],
    },
    {
      label: "Move to",
      items: [
        { id: "archive", label: "Archive", icon: Archive, onSelect: archive },
        { id: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: vi.fn() },
        { id: "snooze", label: "Snooze", disabled: true, onSelect: vi.fn() },
      ],
    },
  ];
}

describe("ContextMenu (US-D09 §c.7)", () => {
  it("stays closed until the trigger is pressed, then shows every group", () => {
    menu(twoGroups());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    press(screen.getByRole("button", { name: "More actions" }));

    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText("Reply")).toBeInTheDocument();
    expect(within(panel).getByText("Archive")).toBeInTheDocument();
    expect(within(panel).getByText("Delete")).toBeInTheDocument();
    // §c.7's optional grey caption, and only on the group that has one.
    expect(within(panel).getByText("Move to")).toBeInTheDocument();
    expect(panel.querySelectorAll(".context-menu__group-label")).toHaveLength(1);
  });

  it("wears the shared glass field and no fill of its own", () => {
    // Reviewer check 1: the popover is `.glass-surface`, it does not declare a `background`. The
    // fill lives in tokens.css, which is what keeps the menu and the chip popover the same panel.
    menu(twoGroups());
    press(screen.getByRole("button", { name: "More actions" }));

    const panel = screen.getByRole("dialog");
    expect(panel.classList.contains("glass-surface")).toBe(true);
    expect(panel).toHaveAttribute("data-glass-slot", "palette");
  });

  it("portals out, so it can never be a glass surface inside another one", () => {
    // Reviewer check 2, structurally: the panel is appended to the body, so even a trigger that
    // lives inside a glass pane opens a menu whose ancestors carry no `.glass-surface`. That is the
    // whole reason the menu is a Radix Portal rather than an absolutely-positioned child.
    menu(twoGroups());
    press(screen.getByRole("button", { name: "More actions" }));

    const panel = screen.getByRole("dialog");
    expect(panel.parentElement?.closest(".glass-surface")).toBeNull();
  });

  it("runs the row's action and closes — a menu row is a decision, not a toggle", () => {
    menu(twoGroups());
    press(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByText("Archive"));

    expect(archive).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("trails the icon behind the label (M115)", () => {
    // The verb is what the eye scans for. Asserting on order rather than on presence is the point:
    // an icon before the label passes "an svg is in the row" and is still the wrong row.
    menu(twoGroups());
    press(screen.getByRole("button", { name: "More actions" }));

    const row = screen.getByText("Archive").closest(".context-menu__item");
    const label = row?.querySelector(".context-menu__label");
    const icon = row?.querySelector(".context-menu__icon");
    expect(label).not.toBeNull();
    expect(icon).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING: the icon comes after the label in document order.
    expect(label?.compareDocumentPosition(icon as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("marks a destructive row, and the glyph with it", () => {
    menu(twoGroups());
    press(screen.getByRole("button", { name: "More actions" }));

    expect(screen.getByText("Delete").closest(".context-menu__item")).toHaveAttribute(
      "data-destructive",
      "true",
    );
    expect(screen.getByText("Archive").closest(".context-menu__item")).not.toHaveAttribute(
      "data-destructive",
    );
    // The glyph is a sibling of the label inside the same row, so one selector colours both — but
    // the icon is a decoration and stays out of the accessible name.
    const icon = screen
      .getByText("Delete")
      .closest(".context-menu__item")
      ?.querySelector(".context-menu__icon");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("leaves a disabled row in place and inert", () => {
    // Hiding it would make the menu a different length depending on state; §c.7 keeps the row and
    // greys it.
    const select = vi.fn();
    menu([{ items: [{ id: "snooze", label: "Snooze", disabled: true, onSelect: select }] }]);
    press(screen.getByRole("button", { name: "More actions" }));

    const row = screen.getByRole("button", { name: "Snooze" });
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(select).not.toHaveBeenCalled();
  });

  it("opens without the menu roles it cannot honour", () => {
    // Radix Popover (unlike DropdownMenu, which this repo does not install) does no roving
    // tabindex and no arrow-key navigation. Claiming role="menu" would promise both.
    menu(twoGroups());
    press(screen.getByRole("button", { name: "More actions" }));

    const panel = screen.getByRole("dialog");
    expect(panel).toHaveAttribute("aria-label", "Thread actions");
    expect(within(panel).queryByRole("menu")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("does not leak a press into the React tree that rendered the trigger", () => {
    // The panel is portaled to the body, so it is not a DOM descendant of the trigger — but React
    // bubbles synthetic events through the React tree, and a portal's parent is the component that
    // rendered the trigger. Every trigger in this app sits inside something that reacts to being
    // pressed (the inbox row opens a thread and starts a swipe drag), so the panel has to stop both
    // events at its own edge. Asserted on an ancestor rather than on the row so it is a statement
    // about the component and not about one caller.
    const outerClick = vi.fn();
    const outerPress = vi.fn();
    const pick = vi.fn();
    render(
      // biome-ignore lint/a11y/useKeyWithClickEvents: this div is the hazard under test, not a control — it exists to catch a press the panel should have stopped, and giving it a keyboard twin would be inventing behaviour for the fixture.
      <div onClick={outerClick} onPointerDown={outerPress}>
        <ContextMenu
          label="Thread actions"
          trigger={
            <button type="button" aria-label="More actions">
              …
            </button>
          }
          groups={[
            {
              items: [
                { id: "open", label: "Open", icon: Reply, onSelect: vi.fn() },
                { id: "archive", label: "Archive", icon: Archive, onSelect: pick },
              ],
            },
          ]}
        />
      </div>,
    );

    press(screen.getByRole("button", { name: "More actions" }));
    // The trigger's own press is the caller's to stop; what matters is that nothing inside the open
    // panel reaches the ancestor either.
    outerClick.mockClear();
    outerPress.mockClear();

    fireEvent.pointerDown(screen.getByText("Archive"));
    fireEvent.click(screen.getByText("Archive"));

    expect(pick).toHaveBeenCalledOnce();
    expect(outerPress).not.toHaveBeenCalled();
    expect(outerClick).not.toHaveBeenCalled();
  });

  it("closes on Escape with the focus back on the trigger", async () => {
    menu(twoGroups());
    const trigger = screen.getByRole("button", { name: "More actions" });
    press(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Radix hands focus back from a `setTimeout(…, 0)` inside its unmount cleanup, so the panel is
    // gone a tick before the focus lands. Waiting is the assertion, not a workaround.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
