import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // zero-client.ts가 읽는 import.meta.env.OMNIS_ZERO_URL은 기본 envPrefix("VITE_")로는
  // 번들에 주입되지 않는다 — 계약 §7이 못박은 오버라이드가 조용히 죽는다.
  envPrefix: ["VITE_", "OMNIS_"],
  clearScreen: false,
  // 허브(127.0.0.1:8787)는 dev 서버와 다른 오리진이고 CORS 헤더를 주지 않는다(계약 §5의 127.0.0.1 경계).
  // dev에서는 같은 오리진으로 프록시하고, 클라이언트는 OMNIS_HUB_HTTP_URL=""로 상대 경로를 쓴다.
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/approvals": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
      "/kill-switch": "http://127.0.0.1:8787",
    },
  },
});
