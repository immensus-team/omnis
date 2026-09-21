import * as Popover from "@radix-ui/react-popover";
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

// US-D09 §c.7: the contextual menu — M160 (Remind Me) and M115. It is the third caller of the
// floating-panel grammar this repo already had twice (filter-chip-bar.tsx's popover and the rail's
// menu), so it adds no library: Radix Popover places it, `.glass-surface` is its field, and the
// shape is §c.7's own numbers.
//
// Deliberately **not** `role="menu"`/`role="menuitem"`: those roles promise arrow-key navigation and
// a roving tabindex, and Radix Popover (unlike DropdownMenu, which this repo does not install)
// provides neither. A group of real buttons with Tab, Escape and click-outside is the honest wiring;
// claiming the menu role without the keyboard grammar would be worse than not claiming it.

export interface ContextMenuItem {
  id: string;
  label: string;
  /** §c.7: the icon trails the label (M115), 18px in `--text-secondary`. */
  icon?: LucideIcon;
  onSelect: () => void;
  /** §c.7: `--danger-500` for the label **and** the icon (M115 "Block Contact"). */
  destructive?: boolean;
  disabled?: boolean;
}

export interface ContextMenuGroup {
  /** §c.7's optional grey caption above the group ("Move to", "Label"). */
  label?: string;
  items: ContextMenuItem[];
}

export interface ContextMenuProps {
  /** The trigger, rendered through `asChild` — the row's `…` button, the toolbar's "more". Its
   *  accessible name is the trigger's business, not this component's. */
  trigger: ReactNode;
  groups: ContextMenuGroup[];
  /** The panel's own name, for the case where it is reached without seeing the trigger. */
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

export function ContextMenu({
  trigger,
  groups,
  label,
  side = "bottom",
  align = "end",
  sideOffset = 6,
}: ContextMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="glass-surface context-menu"
          data-glass-slot="palette"
          aria-label={label}
          side={side}
          align={align}
          sideOffset={sideOffset}
          // The panel is portaled to the body, so nothing inside it is a DOM descendant of the
          // trigger — but React bubbles synthetic events through the *React* tree, and the portal's
          // parent is the component that rendered the trigger. Without this, picking "Archive" in a
          // row's menu also runs the row's own click and opens the thread, and a press inside the
          // menu starts the row's swipe drag with it. One stop at the panel's edge covers the rows
          // and the padding around them, and it is the panel's job rather than each caller's: every
          // trigger in this app sits inside something that reacts to being pressed.
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {groups.map((group, index) => (
            // Groups are separated by the gap and never by a rule (§c.7). The key is the group's
            // label when it has one and the position when it does not — two unlabelled groups in
            // one menu is legal, two identical labels in one menu is the caller's bug.
            <div key={group.label ?? `group-${index}`} className="context-menu__group">
              {group.label !== undefined && (
                <p className="context-menu__group-label">{group.label}</p>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="context-menu__item"
                    data-destructive={item.destructive === true ? "true" : undefined}
                    disabled={item.disabled}
                    onClick={() => {
                      item.onSelect();
                      // A menu row is a decision, so it closes. The chip popover next door stays
                      // open on purpose — that one is a multi-select list, not a set of decisions.
                      setOpen(false);
                    }}
                  >
                    <span className="context-menu__label">{item.label}</span>
                    {Icon !== undefined && (
                      <Icon className="context-menu__icon" size={18} aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
