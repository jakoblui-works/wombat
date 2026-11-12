import type { WombatBridge } from "../../shared/bridge.ts";

// What the preload (src/preload/index.ts) exposes; nothing else is on `window` from app code.
declare global {
  interface Window {
    readonly wombat: WombatBridge;
  }
}
