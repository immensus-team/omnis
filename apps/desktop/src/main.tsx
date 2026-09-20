import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@omnis/ui/tokens.css";
import { App } from "./App.js";
import { loadZeroToken } from "./zero-client.js";

const root = document.getElementById("root");
if (root === null) throw new Error("#root not found in index.html");

// US-A21b: Zero permissions는 허브가 서명한 토큰 없이는 한 행도 안 내려준다. 화면이 뜨기 전에
// 한 번 받아 둔다 — 실패해도(허브가 아직 안 떴다 등) 앱은 띄우고 Zero만 빈 상태로 시작한다.
loadZeroToken()
  .catch((e: unknown) => {
    console.error("zero auth token unavailable — rows will not sync", e);
  })
  .finally(() => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
