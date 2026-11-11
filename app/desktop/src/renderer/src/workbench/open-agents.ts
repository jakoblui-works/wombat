// Open-agent requests (a notification click) wait here until the saved layout is restored: restoring replaces every
// tab, so a chat opened before it would be lost.
export type OpenAgents = {
  /** Hands the request to the handler, or keeps it until there is one. */
  push: (agentId: string) => void;
  /** Applies every kept request to `handler`, then each new one; returns the function that detaches it. */
  open: (handler: (agentId: string) => void) => () => void;
};

export const openAgents = (): OpenAgents => {
  const waiting: string[] = [];
  let current: ((agentId: string) => void) | undefined;
  return {
    push: (agentId) => {
      if (current === undefined) waiting.push(agentId);
      else current(agentId);
    },
    open: (handler) => {
      current = handler;
      for (const agentId of waiting.splice(0)) handler(agentId);
      return () => {
        if (current === handler) current = undefined;
      };
    },
  };
};
