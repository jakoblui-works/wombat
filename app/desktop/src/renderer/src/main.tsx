import { CSPProvider } from "@base-ui/react/csp-provider";
import { lazy, StrictMode, Suspense, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { cspNonce } from "./lib/csp-nonce.ts";
import "./styles/globals.css";

// A task's proof page (`*.proof.tsx`, never committed) mounts instead of the app when the page is
// opened with its hash; the glob keeps the build working when there is none.
const proofs = import.meta.glob<{ CspProof: ComponentType }>("./*.proof.tsx");
const loadCspProof = proofs["./csp.proof.tsx"];
const CspProof =
  location.hash === "#csp-proof" && loadCspProof
    ? lazy(async () => ({ default: (await loadCspProof()).CspProof }))
    : null;

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element; check src/renderer/index.html.");

createRoot(root).render(
  <StrictMode>
    <CSPProvider nonce={cspNonce()}>
      {CspProof ? (
        <Suspense>
          <CspProof />
        </Suspense>
      ) : (
        <App />
      )}
    </CSPProvider>
  </StrictMode>,
);
