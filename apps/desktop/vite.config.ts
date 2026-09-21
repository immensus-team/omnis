import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// OMNIS_HUB_PORT moves the proxy target with the hub (tools/e2e runs a second stack on other ports).
const hub = `http://127.0.0.1:${process.env.OMNIS_HUB_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  // `import.meta.env.OMNIS_ZERO_URL`, which zero-client.ts reads, is not injected into the bundle
  // under the default envPrefix ("VITE_") — an override the contract §7 pins down would die quietly.
  envPrefix: ["VITE_", "OMNIS_"],
  clearScreen: false,
  // The hub (127.0.0.1:8787) is a different origin from the dev server and sends no CORS headers
  // (the 127.0.0.1 boundary of contract §5). In dev everything is proxied to the same origin and the
  // client sets OMNIS_HUB_HTTP_URL="" to use relative paths — so this table is the whole list of
  // routes the app may call. A path missing from it fails *quietly*: Vite's SPA fallback answers the
  // GET with index.html and a 200, `fetchSettings` dies in `res.json()` and returns `{}`, and every
  // preference falls back to its default with nothing in the console. US-D10's two `ui.detail_*`
  // writes are how `/settings` was found missing here.
  server: {
    port: Number(process.env.OMNIS_DESKTOP_PORT ?? 5173),
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api": hub,
      "/approvals": hub,
      "/health": hub,
      "/kill-switch": hub,
      // US-B27: the palette's search mode. Without this entry the app's GET /search lands on the
      // Vite server (a 404 — the request never reaches the hub) and the panel can only ever show
      // its "No results" state, however good the hub's answer is.
      "/search": hub,
      // US-B33: the Settings screen's three reads and its writes — GET/PUT /settings/:key, GET /cost.
      // Same failure mode as /search above, and the reason it has to be spelled out twice: prefix is
      // the whole match rule, so "/settings" covers "/settings/cost.cap_usd" but nothing else here,
      // and /cost is a separate route. The screen's `data-state` lands on "error" without these.
      // US-D10 writes the same two keys the detail pane's layout lives in, through the same prefix.
      "/settings": hub,
      "/cost": hub,
      // US-B31/B32: `api/notes.ts`, `api/digest.ts` and `api/tasks.ts` call these three families —
      // POST /notes and /notes/:id/route, POST /items/:id/unarchive, POST /digests/:id/undo, and
      // POST /tasks (the Tasks screen's quick-add). A write that misses this table is the failure
      // this file's header describes with the worst consequence: unlike a settings read, a dropped
      // POST does not fall back to a default, it is simply lost.
      "/notes": hub,
      "/items": hub,
      "/digests": hub,
      "/tasks": hub,
    },
  },
});
