/** The line a view of an agent's log shows when the log couldn't be read (and nothing of it was read before). */
export const LogError = ({ error }: { error: Error }) => (
  <p role="alert" className="p-5 text-sm text-danger">
    Couldn't read this agent's log: {error.message}
  </p>
);
