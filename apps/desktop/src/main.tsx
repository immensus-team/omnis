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

/** `?screen=<name>` opens a screen for looking at and for screenshots. There is no URL router in
 *  the desktop app (src-tauri loads one document), and the rail that switches screens for a person
 *  is not built yet, so this is how a screen that is not the Inbox is reached.
 *  - `onboarding` (US-D06 §4.1.3): no first-run flow is wired yet, and wiring one is not D6's job.
 *  - `today` (US-B28): the shell's Screen switching belongs to whoever builds the rail; this story
 *    adds the screen and has to be able to photograph it in the real shell.
 *  - `tasks` (US-B29): same reason, same owner. */
function previewElement() {
  const screen = new URLSearchParams(window.location.search).get("screen");
  if (screen === "onboarding") return <OnboardingPreview />;
  if (screen === "today") return <App screen="today" />;
  if (screen === "tasks") return <App screen="tasks" />;
  if (screen === "network") return <App screen="network" />;
  // `notes` (US-B31): same reason as `today`/`tasks`/`network` — the rail that switches screens is
  // not built yet, and the story has to be able to photograph the screen in the real shell.
  if (screen === "notes") return <App screen="notes" />;
  // `digest` (US-B32): same reason — the screen has to be photographable in the real shell, and the
  // rail that switches screens is still not built.
  if (screen === "digest") return <App screen="digest" />;
  // `settings` (US-B33): same reason — and the screen cannot be photographed from the rail either,
  // because the rail's Settings tile is still the Phase B disabled one (ChannelRail's PHASE_B_TITLE
  // note); wiring the rail is the shell's story, not this screen's.
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
