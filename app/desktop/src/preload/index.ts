import { API_VERSION } from "@wombat/shared";
import { contextBridge } from "electron";

// The page's only bridge to the host. Everything added here widens what a page can reach;
// keep it in step with the allow-lists in e2e/trust-boundary.e2e.ts.
contextBridge.exposeInMainWorld("wombat", { apiVersion: API_VERSION });
