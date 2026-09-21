import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@omnis/ui/tokens.css";
import "./app.css";
import { App } from "./App.js";

const root = document.getElementById("root");
if (root === null) throw new Error("#root not found in index.html");

// A5 §4.5: a page with no service worker is a bookmark, not an installed app — Safari only offers
// Add to Home Screen as an install when one is registered. Registered in production only: the dev
// server serves no worker (vite-plugin-pwa generates it in `build`), and registering there would
// fail on every reload for no benefit. `registerType: "prompt"` means a new worker waits rather
// than reloading the page under the user's hands.
if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
