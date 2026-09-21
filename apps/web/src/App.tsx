import { ZeroProvider } from "@rocicorp/zero/react";
import { useState } from "react";
import { BottomTabBar, TAB_LABEL, type WebTab } from "./components/BottomTabBar.js";
import { InstallGuideCard } from "./components/InstallGuideCard.js";
import { Inbox } from "./screens/Inbox.js";
import { initZero } from "./zero-client.js";

// Module scope would open a WebSocket on import alone; the client is created on first render.
let zeroClient: ReturnType<typeof initZero> | undefined;
function getZero() {
  zeroClient ??= initZero();
  return zeroClient;
}

/** A5 §4.5: the guide is for a browser that has no install prompt of its own (Safari), and an
 *  already-installed app is the one case where it is not merely useless but wrong — so the check
 *  is `display-mode: standalone`, not "has it been dismissed before". */
function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

export function App() {
  // Without ZeroProvider, useQuery dies with "useZero must be used within a ZeroProvider".
  return (
    <ZeroProvider zero={getZero()}>
      <Shell />
    </ZeroProvider>
  );
}

function Shell() {
  const [tab, setTab] = useState<WebTab>("inbox");
  const [showInstallGuide, setShowInstallGuide] = useState(() => !isStandalone());
  // The row grammar's selection is a thread id (U2: a row is one thread). What a selected row
  // opens is the next slice — A5 §4.2 makes a pending-approval row open its approval sheet on tap.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="web-shell" data-active-tab={tab}>
      <header className="web-shell__topbar">
        <h1 className="web-shell__title">{TAB_LABEL[tab]}</h1>
      </header>
      <main className="web-shell__body" data-screen={tab}>
        {/* A5 §4.5: the guide sits at the top of the list rather than over it, so the list is
            readable while it is up. */}
        {showInstallGuide && <InstallGuideCard onDismiss={() => setShowInstallGuide(false)} />}
        {/* Only the landing tab has a body so far. The other four are the plan's open question
            (reusing apps/desktop's screens is the goal, but an app may depend on @omnis/ui and
            never on another app), so they are left empty rather than filled with something that
            would only have to be thrown away. */}
        {tab === "inbox" && <Inbox selectedId={selectedId} onSelect={setSelectedId} />}
      </main>
      <BottomTabBar active={tab} onSelect={setTab} />
    </div>
  );
}
