import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@omnis/ui/tokens.css";
import "./app.css";
import { App } from "./App.js";
import { type OAuthClient, Onboarding } from "./screens/Onboarding.js";
import { loadZeroToken } from "./zero-client.js";

const root = document.getElementById("root");
if (root === null) throw new Error("#root not found in index.html");

// US-A21b: Zero permissions hand down not a single row without a hub-signed token, so one is
// fetched before the screen appears. A failure (the hub is not up yet, say) still mounts the app —
// it just starts with Zero empty.
loadZeroToken()
  .catch((e: unknown) => {
    console.error("zero auth token unavailable — rows will not sync", e);
  })
  .finally(() => {
    createRoot(root).render(<StrictMode>{previewElement()}</StrictMode>);
  });

/** `?screen=<name>` sets the screen the shell opens on, for looking at and for screenshots. It is
 *  the *first* screen only: the rail, `g` + a letter and the palette all switch screens from there
 *  (App.tsx's goTo), and a URL cannot follow them — there is no URL router in the desktop app
 *  (src-tauri loads one document), so it is not re-read and not written back.
 *  - `onboarding` (US-D06 §4.1.3): no first-run flow is wired yet, and wiring one is not D6's job.
 *    The one screen here that is not a ShellScreen — it is mounted instead of the shell.
 *  - the seven shell screens are all reachable from the rail now (loop-r1-01); this is how a shot
 *    tool asks for one before it has clicked anything. */
function previewElement() {
  const screen = new URLSearchParams(window.location.search).get("screen");
  if (screen === "onboarding") return <OnboardingPreview />;
  if (screen === "today") return <App screen="today" />;
  if (screen === "tasks") return <App screen="tasks" />;
  if (screen === "network") return <App screen="network" />;
  if (screen === "notes") return <App screen="notes" />;
  if (screen === "digest") return <App screen="digest" />;
  if (screen === "settings") return <App screen="settings" />;
  return <App />;
}

/** The preview's OAuth client rejects: that is what leaves the screen in the resting state a
 *  first-run user actually sees — three Connect buttons and a disabled Continue — and it is also
 *  the shortest path to the error state, which is the other state worth looking at. Nothing here
 *  reaches the keychain, so the preview cannot store a real secret by accident. */
const PREVIEW_OAUTH: OAuthClient = {
  connect: () => Promise.reject(new Error("onboarding preview: no OAuth flow is wired yet")),
};

function OnboardingPreview() {
  return <Onboarding oauthClient={PREVIEW_OAUTH} onDone={() => undefined} />;
}
