// STUB (test writer, S3): T6's builder replaces this module. The names and types are interface-S3's; APP_ROUTES is
// left empty for the builder to fill, MAX_BODY_BYTES has the service's cap (1 MiB).

/** One route the app may call; path parameters as `:name`. */
export type AppRoute = { method: "GET" | "POST" | "DELETE"; pattern: string };

/** Every route the app may call (the bridge's allow-list, checked in main). */
export const APP_ROUTES: readonly AppRoute[] = [];

/** The largest request body the service takes, and main lets through. */
export const MAX_BODY_BYTES = 1024 * 1024;
