import type { Unsubscribe } from "../shared/bridge.ts";

export type HeldEvents<T> = {
  /** An event from main: given to every subscriber, or held while there is none. */
  take: (value: T) => void;
  /** Gets the held events at once (the first subscriber only), then every new one. */
  subscribe: (cb: (value: T) => void) => Unsubscribe;
};

/** Events main may send before the page has subscribed (an open-agent request right after load), kept for the page. */
export const heldEvents = <T>(): HeldEvents<T> => {
  const held: T[] = [];
  const listeners = new Set<(value: T) => void>();
  return {
    take: (value) => {
      if (listeners.size === 0) held.push(value);
      for (const cb of listeners) cb(value);
    },
    subscribe: (cb) => {
      listeners.add(cb);
      for (const value of held.splice(0)) cb(value);
      return () => {
        listeners.delete(cb);
      };
    },
  };
};
