import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element; check src/renderer/index.html.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
