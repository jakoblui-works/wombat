/** The agent service's API version; the app refuses a mismatch. */
export const API_VERSION = 3;

/** The desktop app's own origin: its pages are served from it, and it's the only Origin the service accepts. */
export const APP_ORIGIN = "app://wombat";

/**
 * The env vars the service reads one workspace's root and items root from, when set; the app sets them when it starts
 * the service.
 */
export const SERVICE_ENV = { workspace: "WOMBAT_WORKSPACE", items: "WOMBAT_ITEMS" } as const;
