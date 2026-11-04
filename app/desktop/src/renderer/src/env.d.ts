import type { API_VERSION } from "@wombat/shared";

// What the preload (src/preload/index.ts) exposes; nothing else is on `window` from app code.
declare global {
  interface Window {
    readonly wombat: {
      readonly apiVersion: typeof API_VERSION;
    };
  }
}
