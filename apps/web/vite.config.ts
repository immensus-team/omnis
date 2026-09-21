import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// OMNIS_HUB_PORT moves the proxy target with the hub (tools/e2e runs a second stack on other ports).
const hub = `http://127.0.0.1:${process.env.OMNIS_HUB_PORT ?? 8787}`;
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // A5 §4.5: the service worker exists so Safari will install the app (an added-to-home-screen
    // page with no worker is just a bookmark). Its caching is deliberately left at the plugin's
    // default — tuning the precache list is a follow-up, and the app is useless offline anyway
    // (every screen reads Zero over the Tailscale link).
    VitePWA({
      registerType: "prompt",
      // The manifest is a checked-in file served as-is (public/manifest.webmanifest) so that what
      // Safari reads is what is in the repo.
      manifest: false,
      injectRegister: false,
      includeAssets: ["icon.svg"],
    }),
  ],
  // import.meta.env.OMNIS_ZERO_URL / OMNIS_HUB_HTTP_URL are read by zero-client.ts. The default
  // envPrefix ("VITE_") would leave them undefined, which silently pins the app to the localhost
  // defaults — the same trap apps/desktop/vite.config.ts documents.
  envPrefix: ["VITE_", "OMNIS_"],
  clearScreen: false,
  // The hub (127.0.0.1:8787) is a different origin from the dev server and sends no CORS headers,
  // so in dev it is proxied onto the same origin and the client uses relative paths
  // (OMNIS_HUB_HTTP_URL=""). Prefix is the whole match rule, so every hub route the shell touches
  // is spelled out: /api carries the Zero token, and /approvals is the detail pane's decision.
  server: {
    port: Number(process.env.OMNIS_WEB_PORT ?? 5173),
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api": hub,
      "/approvals": hub,
      "/health": hub,
      // US-B36: the push subscribe call is a cross-origin POST with a JSON content-type, which
      // means a preflight the hub does not answer (it sends no CORS headers) — so it has to travel
      // through this proxy like every other hub write. The hub accepts /push/… and /api/push/… alike.
      "/push": hub,
    },
  },
});
