import { GlassSurface } from "@omnis/ui";

/** A5 §4.1: the bar is fixed at five slots — Inbox·Today·Tasks·Network·Notes. Digest and Settings
 *  are deliberately not here: Settings moves to the top bar's ⚙ (shown on every tab) and Digest is
 *  reached from the Today card or a push, because neither is a screen you must check during
 *  triage. Inbox is first and is what the app opens on. */
export const WEB_TABS = ["inbox", "today", "tasks", "network", "notes"] as const;
export type WebTab = (typeof WEB_TABS)[number];

/** Exported so the top bar's title and the bar itself cannot drift apart (A5 §4.1: the top bar
 *  carries the current tab's name). */
export const TAB_LABEL: Record<WebTab, string> = {
  inbox: "Inbox",
  today: "Today",
  tasks: "Tasks",
  network: "Network",
  notes: "Notes",
};

/** The bar is navigation chrome sitting over a scrolling list, which is exactly where the design
 *  direction puts glass (DESIGN-DIRECTION "glass on chrome only"). */
export function BottomTabBar({
  active,
  onSelect,
}: {
  active: WebTab;
  onSelect: (tab: WebTab) => void;
}) {
  return (
    <GlassSurface
      slot="toolbar"
      className="tab-bar"
      role="tablist"
      aria-label="Main screens"
      data-active-tab={active}
    >
      {WEB_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={active === tab}
          className="tab-bar__tab"
          data-tab={tab}
          onClick={() => onSelect(tab)}
        >
          {TAB_LABEL[tab]}
        </button>
      ))}
    </GlassSurface>
  );
}
