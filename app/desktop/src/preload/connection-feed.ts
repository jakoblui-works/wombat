import type { ConnectionState, ConnectionUpdate, Unsubscribe } from "../shared/bridge.ts";

export type ConnectionFeed = {
  /** A state from main, pushed or asked for; one older than the latest seen is dropped. */
  take: (update: ConnectionUpdate) => void;
  /** Calls `cb` with the latest state at once (when there is one yet), then with every newer one. */
  subscribe: (cb: (state: ConnectionState) => void) => Unsubscribe;
};

/** The page's view of the connection: main pushes changes, and the preload asks once for the state at load. */
export const connectionFeed = (): ConnectionFeed => {
  let latest: ConnectionUpdate | undefined;
  const listeners = new Set<(state: ConnectionState) => void>();
  return {
    take: (update) => {
      if (latest !== undefined && latest.seq >= update.seq) return;
      latest = update;
      for (const cb of listeners) cb(update.state);
    },
    subscribe: (cb) => {
      listeners.add(cb);
      if (latest !== undefined) cb(latest.state);
      return () => {
        listeners.delete(cb);
      };
    },
  };
};
