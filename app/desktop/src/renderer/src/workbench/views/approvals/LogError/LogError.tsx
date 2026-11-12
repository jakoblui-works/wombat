/** The line a view of an agent's log shows when the log couldn't be read (and nothing of it was read before). */
export const LogError = ({ error }: { error: Error }) => (
  <p role="alert" className="p-5 text-sm text-danger">
    Couldn't read this agent's log: {error.message}
  </p>
);

/** The line a list of the agents (Agents, Needs me) shows when they couldn't be read (and none were read before). */
export const AgentsError = ({ error }: { error: Error }) => (
  <p role="alert" className="px-3 pt-3 text-sm text-danger">
    Couldn't read the agents: {error.message}
  </p>
);
