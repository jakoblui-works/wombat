import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

import type { AgentSummary, Workspace } from "@wombat/shared/api";
import type { Proposal } from "@wombat/shared/proposals";
import { useAgents, useProposals, useWorkspaces } from "../../data/hooks.ts";
import { emptyShell, type ShellState, shownWorkspace } from "./shell-state.ts";

/** The shell state, the lists as the page has read them (undefined while unread) and the shown workspace's id. */
export type ShellNow = {
  state: ShellState;
  agents: AgentSummary[] | undefined;
  proposals: readonly Proposal[] | undefined;
  workspaces: readonly Workspace[] | undefined;
  shown: string | undefined;
};

export type Shell = {
  state: ShellState;
  change: (update: (state: ShellState) => ShellState) => void;
  /** As of the latest render: a change queued in the same event isn't in it yet. */
  current: () => ShellNow;
};

const ShellContext = createContext<Shell | undefined>(undefined);

const shownIn = (state: ShellState, agents: AgentSummary[] | undefined, workspaces: readonly Workspace[] | undefined): Workspace | undefined => {
  const id = shownWorkspace(state, agents, workspaces);
  return workspaces?.find((workspace) => workspace.id === id);
};

export const ShellProvider = ({ initial = emptyShell, children }: { initial?: ShellState; children: ReactNode }) => {
  const [state, setState] = useState(initial);
  const agents = useAgents().data?.agents;
  const proposals = useProposals().data?.proposals;
  const workspaces = useWorkspaces().data?.workspaces;
  const latest: ShellNow = { state, agents, proposals, workspaces, shown: shownIn(state, agents, workspaces)?.id };
  const now = useRef(latest);
  now.current = latest;
  const change = useCallback((update: (state: ShellState) => ShellState) => setState(update), []);
  const current = useCallback(() => now.current, []);
  const value = useMemo(() => ({ state, change, current }), [state, change, current]);
  return <ShellContext value={value}>{children}</ShellContext>;
};

/** The shell's state and its one change function, which takes one of `shell-state.ts`'s functions. */
export const useShell = (): Shell => {
  const shell = useContext(ShellContext);
  if (shell === undefined) throw new Error("useShell is used outside the ShellProvider; render the component inside it.");
  return shell;
};

/** The shown workspace; undefined while the lists aren't read or the service lists none. */
export const useShownWorkspace = (): Workspace | undefined =>
  shownIn(useShell().state, useAgents().data?.agents, useWorkspaces().data?.workspaces);
