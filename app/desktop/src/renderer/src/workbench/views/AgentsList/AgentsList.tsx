import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../components/ui/button";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { AGENT_STATES } from "../../../lib/agent-state";
import { useNow } from "../../../lib/ago";
import { useAgents, useRepos } from "../../../data/hooks.ts";
import { SidebarHeader } from "../../SidebarHeader/SidebarHeader.tsx";
import { useActiveTab, useWorkbench } from "../../workbench-context.ts";
import { CHAT_VIEW, ChatParams } from "../Chat/chat-params.ts";
import { AgentRow } from "./AgentRow.tsx";
import { groupAgents } from "./group-agents.ts";
import { NewAgentDialog } from "./NewAgentDialog.tsx";

/** The Agents sidebar: every agent, grouped by state with what needs me first. */
export const AgentsList = () => {
  const agents = useAgents();
  const { openTab } = useWorkbench();
  const active = useActiveTab();
  const now = useNow();
  const [creating, setCreating] = useState(false);
  // The workspace folder's name comes from the service's folder list (its first entry, ".").
  const repos = useRepos();
  const workspaceName = repos.data?.repos.find(({ path }) => path === ".")?.name ?? ".";

  const activeAgentId = active?.viewId === CHAT_VIEW ? ChatParams.safeParse(active.params).data?.agentId : undefined;
  const list = agents.data?.agents;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarHeader title="Agents" {...(list === undefined ? {} : { count: list.length })}>
        <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
          <Plus />
          New agent
        </Button>
      </SidebarHeader>
      {repos.error && repos.data === undefined ? (
        <p role="alert" className="px-3 pt-3 text-sm text-danger">
          Couldn't read the workspace folders: {repos.error.message}
        </p>
      ) : null}
      {agents.error && list === undefined ? (
        <p role="alert" className="p-3 text-sm text-danger">
          Couldn't read the agents: {agents.error.message}
        </p>
      ) : list === undefined ? (
        <p className="p-3 text-sm text-fg-tertiary">Loading…</p>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-base font-medium text-fg-primary">No agents yet</p>
          <p className="text-sm text-fg-tertiary">Start one to work on a repo in this workspace.</p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-1 px-1.5 pt-1 pb-3">
            {groupAgents(list).map(({ state, agents: inGroup }) => (
              <section key={state} aria-label={AGENT_STATES[state].label}>
                <h3 className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-xs font-medium text-fg-tertiary">
                  <span>{AGENT_STATES[state].label}</span>
                  <span className="tabular-nums">{inGroup.length}</span>
                </h3>
                {inGroup.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    workspaceName={workspaceName}
                    now={now}
                    selected={agent.id === activeAgentId}
                    onOpen={() => openTab(CHAT_VIEW, { agentId: agent.id })}
                  />
                ))}
              </section>
            ))}
          </div>
        </ScrollArea>
      )}
      <NewAgentDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
};
