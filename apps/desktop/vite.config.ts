import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // zero-client.ts가 읽는 import.meta.env.OMNIS_ZERO_URL은 기본 envPrefix("VITE_")로는
  // 번들에 주입되지 않는다 — 계약 §7이 못박은 오버라이드가 조용히 죽는다.
  envPrefix: ["VITE_", "OMNIS_"],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
});
