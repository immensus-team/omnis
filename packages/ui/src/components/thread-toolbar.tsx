import { type LucideIcon, MoreHorizontal } from "lucide-react";
import { cn } from "../lib/cn.js";
import { ContextMenu, type ContextMenuGroup } from "./context-menu.js";
import { GlassSurface } from "./glass-surface.js";

// US-D09 §c.5 / §c.9 — M103 (toolbars). One bar of icon buttons with two shapes: the detail pane's
// sticky glass capsule in the wide tier, and the same controls as the sheet's own chrome row
// wherever the pane is itself a sheet — 900–1279.98 and (S5) below 900, where the pane is a `vaul`
// drawer. Both of those pass `variant="chrome"`.
//
// It is one component rather than two because §c.5's bars differ in exactly two numbers — their
// height and where they are positioned — and everything else about them is the same claim: a row of
// icon buttons that each carry a label. Two components would have drifted into two button sizes and
// two hover states within a story.
//
// No `role="toolbar"`: that role announces a widget whose arrow keys move between its controls, and
// nothing here implements roving focus. The buttons are ordinary buttons in a row, reachable with
// Tab, which is what they actually are.

export interface ThreadToolbarAction {
  id: string;
  /** The accessible name **and** the tooltip. These buttons are icon-only, so the label is the only
   *  thing that says what they do (§e guard 9). */
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** A control whose destination does not exist yet is disabled with the reason in its title
   *  rather than announced as actionable and doing nothing — the pattern the rail's tiles and the
   *  BottomBar's circles already use (channel-rail.tsx's PHASE_B_TITLE). */
  disabled?: boolean;
  /** The tooltip, when it has more to say than the name — a disabled control saying *why* it is
   *  disabled. Defaults to `label`, so the ordinary case states one string once. */
  title?: string;
}

export interface ThreadToolbarProps {
  actions: ThreadToolbarAction[];
  /** §c.7's contextual menu, drawn as one more button at the end of the bar. `label` names both
   *  the trigger and the panel, so a screen reader hears the same word the tooltip shows. */
  menu?: { label: string; groups: ContextMenuGroup[] };
  className?: string;
  /** `glass` (the default) is the bar's own material: a capsule of the chrome layer. `chrome` is
   *  the same bar with **no material of its own**, for the one place it stands on a surface that is
   *  already glass — the 900–1279.98 pane, which app.css draws as a floating glass sheet. A glass
   *  capsule inside a glass sheet is the nesting ACCENT §4.4 rejects, and taking the recipe off by
   *  CSS alone would leave the class on the element: the sheet's own field is what the buttons then
   *  stand on, which is what "the sheet's chrome" means. */
  variant?: "glass" | "chrome";
}

export function ThreadToolbar({ actions, menu, className, variant = "glass" }: ThreadToolbarProps) {
  const content = (
    <>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            className="thread-toolbar__button"
            aria-label={action.label}
            title={action.title ?? action.label}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            <Icon size={18} aria-hidden="true" />
          </button>
        );
      })}
      {menu !== undefined && (
        <ContextMenu
          label={menu.label}
          groups={menu.groups}
          // The menu opens below its own button, aligned to the button's trailing edge, so the panel
          // grows out of the control that was pressed (apple-design §7) instead of appearing under
          // the middle of the bar.
          align="end"
          trigger={
            <button
              type="button"
              className="thread-toolbar__button"
              aria-label={menu.label}
              title={menu.label}
            >
              <MoreHorizontal size={18} aria-hidden="true" />
            </button>
          }
        />
      )}
    </>
  );

  if (variant === "chrome") {
    // Deliberately not a GlassSurface, and deliberately not given a fill to stand in for one: it is
    // a row of the sheet's chrome, and the sheet is what is behind it.
    return (
      <div className={cn("thread-toolbar", "thread-toolbar--chrome", className)}>{content}</div>
    );
  }

  // The glass is the bar's own field, and the bar does not declare a background: the fill, the
  // blur and the lift are tokens.css's recipe, which is what keeps this capsule and the BottomBar's
  // circles the same material. `slot="toolbar"` is honest in both tiers — a bar of controls.
  return (
    <GlassSurface slot="toolbar" className={cn("thread-toolbar", className)}>
      {content}
    </GlassSurface>
  );
}
