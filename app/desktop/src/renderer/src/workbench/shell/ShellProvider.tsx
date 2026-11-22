import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

import type { Workspace } from "@wombat/shared/api";
import { useAgents, useWorkspaces } from "../../data/hooks.ts";
import { emptyShell, type ShellState, shownWorkspace } from "./shell-state.ts";

export type Shell = { state: ShellState; change: (update: (state: ShellState) => ShellState) => void };

const ShellContext = createContext<Shell | undefined>(undefined);

export const ShellProvider = ({ initial = emptyShell, children }: { initial?: ShellState; children: ReactNode }) => {
  const [state, setState] = useState(initial);
  const change = useCallback((update: (state: ShellState) => ShellState) => setState(update), []);
  const value = useMemo(() => ({ state, change }), [state, change]);
  return <ShellContext value={value}>{children}</ShellContext>;
};

/** The shell's state and its one change function, which takes one of `shell-state.ts`'s functions. */
export const useShell = (): Shell => {
  const shell = useContext(ShellContext);
  if (shell === undefined) throw new Error("useShell is used outside the ShellProvider; render the component inside it.");
  return shell;
};

/** The shown workspace; undefined while the lists aren't read or the service lists none. */
export const useShownWorkspace = (): Workspace | undefined => {
  const { state } = useShell();
  const agents = useAgents().data?.agents;
  const workspaces = useWorkspaces().data?.workspaces;
  const id = shownWorkspace(state, agents, workspaces);
  return workspaces?.find((workspace) => workspace.id === id);
};
