import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@omnis/ui/tokens.css";
import "./gallery.css";
import "./vendor/app-styles.css";
import { App } from "./App.js";

const root = document.getElementById("root");
if (root === null) throw new Error("#root not found in index.html");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
