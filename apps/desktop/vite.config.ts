import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/approvals": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
      "/kill-switch": "http://127.0.0.1:8787",
      "/settings": "http://127.0.0.1:8787",
    },
  },
});
