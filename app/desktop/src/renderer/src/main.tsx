import "./lib/zod-config.ts";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { lazy, StrictMode, Suspense, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { connectAlerts } from "./data/alerts.ts";
import { createQueryClient } from "./data/query-client.ts";
import { cspNonce } from "./lib/csp-nonce.ts";
import "./styles/globals.css";
import { openAgents } from "./workbench/open-agents.ts";

// A task's proof page (`*.proof.tsx`, never committed) mounts instead of the app when the page is
// opened with its hash; the glob keeps the build working when there is none.
const proofs = import.meta.glob<{ CspProof: ComponentType }>("./*.proof.tsx");
const loadCspProof = proofs["./csp.proof.tsx"];
const CspProof =
  location.hash === "#csp-proof" && loadCspProof
    ? lazy(async () => ({ default: (await loadCspProof()).CspProof }))
    : null;

// The static design screens (`#design/<screen>`) exist only in a `--mode design` build: the normal build folds this
// to null and leaves the design code out.
const DesignApp =
  import.meta.env.MODE === "design" && location.hash.startsWith("#design")
    ? lazy(async () => ({ default: (await import("./design/DesignApp/DesignApp.tsx")).DesignApp }))
    : null;

// Subscribed before the first render, so no alert, connection state or open-agent request is missed.
const queryClient = createQueryClient();
connectAlerts(queryClient, window.wombat);
const agentsToOpen = openAgents();
window.wombat.onOpenAgent(agentsToOpen.push);

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element; check src/renderer/index.html.");

createRoot(root).render(
  <StrictMode>
    <CSPProvider nonce={cspNonce()}>
      {CspProof ? (
        <Suspense>
          <CspProof />
        </Suspense>
      ) : DesignApp ? (
        <Suspense>
          <DesignApp />
        </Suspense>
      ) : (
        <App queryClient={queryClient} openAgents={agentsToOpen} />
      )}
    </CSPProvider>
  </StrictMode>,
);
