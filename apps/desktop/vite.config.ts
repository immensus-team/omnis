import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // import.meta.env.OMNIS_ZERO_URL (read by zero-client.ts) is not injected into the bundle under
  // the default envPrefix ("VITE_"), which is how the override contract §7 pins down dies without
  // a word.
  envPrefix: ["VITE_", "OMNIS_"],
  clearScreen: false,
  // The hub (127.0.0.1:8787) is a different origin from the dev server and hands out no CORS
  // headers (contract §5's 127.0.0.1 boundary). In dev it is proxied onto the same origin, and the
  // clients use relative paths (OMNIS_HUB_HTTP_URL="").
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/approvals": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
      "/kill-switch": "http://127.0.0.1:8787",
      // US-B27: the palette's search mode. Without this entry the app's GET /search lands on the
      // Vite server (a 404 — the request never reaches the hub) and the panel can only ever show
      // its "No results" state, however good the hub's answer is.
      "/search": "http://127.0.0.1:8787",
    },
  },
});
