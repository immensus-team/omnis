import { useState } from "react";
import { BottomTabBar, TAB_LABEL, type WebTab } from "./components/BottomTabBar.js";
import { InstallGuideCard } from "./components/InstallGuideCard.js";

/** A5 §4.5: the guide is for a browser that has no install prompt of its own (Safari), and an
 *  already-installed app is the one case where it is not merely useless but wrong — so the check
 *  is `display-mode: standalone`, not "has it been dismissed before". */
function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

export function App() {
  const [tab, setTab] = useState<WebTab>("inbox");
  const [showInstallGuide, setShowInstallGuide] = useState(() => !isStandalone());

  return (
    <div className="web-shell" data-active-tab={tab}>
      <header className="web-shell__topbar">
        <h1 className="web-shell__title">{TAB_LABEL[tab]}</h1>
      </header>
      <main className="web-shell__body" data-screen={tab}>
        {/* The five tab bodies are the plan's own open question (see the commit that lands the
            Inbox body): reusing apps/desktop's screens is the goal, but they cannot be imported —
            apps may depend on @omnis/ui and never on another app (see
            apps/gallery/src/vendor/app-styles.css for the same rule enforced on CSS). */}
        {showInstallGuide && <InstallGuideCard onDismiss={() => setShowInstallGuide(false)} />}
      </main>
      <BottomTabBar active={tab} onSelect={setTab} />
    </div>
  );
}
