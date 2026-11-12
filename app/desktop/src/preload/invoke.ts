// What the preload does to a bridge call on its way to main and back.

/**
 * `patch` without its undefined fields: the settings patch schema takes a field that's there or absent, never one
 * set to undefined (`{ layout: undefined }` would be refused, not mean "no change").
 */
export const withoutUndefined = <T extends object>(patch: T): Partial<T> =>
  Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;

// Electron wraps an error thrown by main's handler as "Error invoking remote method '<channel>': <name>: <message>".
const REMOTE_PREFIX = /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

/** The error main threw, as the page should see it: main's message alone, without Electron's wrapping. */
export const mainError = (error: unknown): Error =>
  new Error(error instanceof Error ? error.message.replace(REMOTE_PREFIX, "") : String(error));

/** `call`'s result, or a rejection with main's own message. */
export const fromMain = <T>(call: Promise<T>): Promise<T> =>
  call.catch((error: unknown) => {
    throw mainError(error);
  });
