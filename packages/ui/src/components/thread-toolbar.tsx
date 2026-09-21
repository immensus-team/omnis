import { type LucideIcon, MoreHorizontal } from "lucide-react";
import { cn } from "../lib/cn.js";
import { ContextMenu, type ContextMenuGroup } from "./context-menu.js";
import { GlassSurface } from "./glass-surface.js";

// US-D09 §c.5 / §c.9 — M103 (toolbars). One capsule of icon buttons, in two tiers: the detail pane's
// sticky bar at 900 and above, and the <900 floating action bar that sits in the BottomBar's line
// between the filters circle and the compose circle.
//
// It is one component rather than two because §c.5's two bars differ in exactly two numbers — their
// height and where they are positioned — and everything else about them is the same claim: glass,
// a capsule, icon buttons that each carry a label. Two components would have drifted into two
// button sizes and two hover states within a story.
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
}

export function ThreadToolbar({ actions, menu, className }: ThreadToolbarProps) {
  return (
    // The glass is the bar's own field, and the bar does not declare a background: the fill, the
    // blur and the lift are tokens.css's recipe, which is what keeps this capsule and the BottomBar's
    // circles the same material. `slot="toolbar"` is honest in both tiers — a bar of controls.
    <GlassSurface slot="toolbar" className={cn("thread-toolbar", className)}>
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
    </GlassSurface>
  );
}

/** The class the <900 bar carries so app.css can position it and size its buttons. Exported as a
 *  literal rather than left to the call site because app-shell.test.tsx reads the same string out
 *  of the stylesheet, and a typo between the two would silently drop the tier's bar. */
export const THREAD_TOOLBAR_FLOATING_CLASS = "thread-toolbar--floating";
