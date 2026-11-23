// For tests only: the shell provider's wiring without React. A shell state of the test's own, what the page knows now
// as the provider builds it, and the open tickets over it, rechecked after each change as the provider does after the
// render that follows it. It lives beside the shell, not in desktop/test/, because that folder is type-checked
// without JSX and the provider is a .tsx module.
import type { AgentSummary, Workspace } from "@wombat/shared/api";

import { openTickets } from "./open-ticket.ts";
import { emptyShell, type ShellState } from "./shell-state.ts";
import { shellNow } from "./ShellProvider.tsx";

/** A shell over the listed `workspaces` and `agents` (none by default) and no proposals, starting at `state`. */
export const fakeShell = ({ workspaces = [], agents = [], state = emptyShell }: { workspaces?: readonly Workspace[]; agents?: AgentSummary[]; state?: ShellState } = {}) => {
  let latest = state;
  const current = () => shellNow(latest, agents, [], workspaces);
  const tickets = openTickets(current);
  const change = (update: (state: ShellState) => ShellState): void => {
    latest = update(latest);
    tickets.recheck();
  };
  return { current, change, tickets };
};
