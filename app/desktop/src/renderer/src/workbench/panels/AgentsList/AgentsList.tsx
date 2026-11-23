import type { AgentSummary, Workspace } from "@wombat/shared/api";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "../../../components/ui/button";
import { Collapse } from "../../../components/ui/collapse";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { useNow } from "../../../lib/ago";
import { useAgents, useWorkspaces } from "../../../data/hooks.ts";
import { useNewAgentDialog } from "../../commands/new-agent-dialog.ts";
import { SidebarHeader } from "../../SidebarHeader/SidebarHeader.tsx";
import { collapseGroup, expandShownAgent, isCollapsed } from "../../agents/collapsed-groups.ts";
import { useOpenAgent } from "../../agents/open-agent-chat.ts";
import { newChat } from "../../shell/shell-state.ts";
import { useShell, useShownWorkspace } from "../../shell/ShellProvider.tsx";
import { AgentsError } from "../../approvals/LogError/LogError.tsx";
import { AgentRow } from "./AgentRow.tsx";
import { groupAgents } from "./group-agents.ts";
import { NewAgentDialog } from "./NewAgentDialog.tsx";

const NO_AGENTS = "No agents yet";

type GroupProps = { workspace: Workspace; agents: readonly AgentSummary[]; now: number };

/** One workspace's agents under a head that collapses and expands them. */
const WorkspaceGroup = ({ workspace, agents, now }: GroupProps) => {
  const { state, change } = useShell();
  const openAgent = useOpenAgent();
  const expanded = !isCollapsed(state, workspace.id);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <section aria-label={workspace.name}>
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          title={workspace.root}
          onClick={() => change((current) => collapseGroup(current, workspace.id, expanded))}
          className="focus-ring flex w-full items-center gap-1.5 rounded-md px-1.5 pt-2 pb-1 text-left text-xs font-medium text-fg-tertiary transition-colors hover:text-fg-secondary"
        >
          <Chevron className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{workspace.name}</span>{" "}
          <span className="tabular-nums">{agents.length}</span>
        </button>
      </h3>
      <Collapse open={expanded}>
        {agents.length === 0 ? (
          <p className="px-2.5 py-1 pl-7 text-sm text-fg-tertiary">{NO_AGENTS}</p>
        ) : (
          agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              workspaceName={workspace.name}
              now={now}
              selected={agent.id === state.openAgent}
              onOpen={() => openAgent(agent.id)}
            />
          ))
        )}
      </Collapse>
    </section>
  );
};

/** The overview: every agent, by workspace, each by state with what needs me first. */
export const AgentsList = () => {
  const agents = useAgents();
  const { state, change } = useShell();
  const shown = useShownWorkspace();
  const now = useNow();
  const [creating, setCreating] = useNewAgentDialog();
  const workspaces = useWorkspaces();

  const list = agents.data?.agents;
  const listRef = useRef(list);
  listRef.current = list;
  const listed = workspaces.data?.workspaces;
  const groups = list === undefined || listed === undefined ? undefined : groupAgents(list, listed);
  const openWorkspace = list?.find(({ id }) => id === state.openAgent)?.workspace;
  // An agent shown without `useOpenAgent` (a workspace shown, the list read after the open) gets its group expanded
  // here; collapsing it again afterwards holds, as a list update doesn't rerun this.
  useEffect(() => {
    change((current) => expandShownAgent(current, current.openAgent, listRef.current));
  }, [state.openAgent, openWorkspace, change]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarHeader title="Agents" {...(groups === undefined ? {} : { count: groups.reduce((sum, group) => sum + group.agents.length, 0) })}>
        <Button variant="secondary" size="sm" onClick={() => change((current) => newChat(current, shown?.id))}>
          <Plus />
          New
        </Button>
      </SidebarHeader>
      {workspaces.error && listed === undefined ? (
        <p role="alert" className="px-3 pt-3 text-sm text-danger">
          Couldn't read the workspaces: {workspaces.error.message}
        </p>
      ) : null}
      {agents.error && list === undefined ? (
        <AgentsError error={agents.error} />
      ) : groups === undefined ? (
        workspaces.error ? null : <p className="p-3 text-sm text-fg-tertiary">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-base font-medium text-fg-primary">{NO_AGENTS}</p>
          <p className="text-sm text-fg-tertiary">Open a folder first (File → Open Folder…)</p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1 px-1.5 pt-1 pb-3">
            {groups.map(({ workspace, agents: inGroup }) => (
              <WorkspaceGroup key={workspace.id} workspace={workspace} agents={inGroup} now={now} />
            ))}
          </div>
        </ScrollArea>
      )}
      <NewAgentDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
};
