import { GitBranch, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AGENT_STATE_ORDER, AGENT_STATES } from "@/lib/agent-state";
import { cn } from "@/lib/utils";
import { AGENTS, type DesignAgent, WORKSPACE } from "../fixtures.ts";
import { SidebarHeader } from "../SidebarHeader/SidebarHeader.tsx";

const AgentRow = ({ agent, selected }: { agent: DesignAgent; selected: boolean }) => {
  const state = AGENT_STATES[agent.state];
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "focus-ring flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2",
        selected && "bg-surface-2",
      )}
    >
      <span className="flex w-full items-center gap-2">
        <state.icon aria-label={state.label} className={cn("size-3.5 shrink-0", state.colour)} />
        <span className="min-w-0 flex-1 truncate text-base font-medium text-fg-primary">{agent.title}</span>
        <span className="shrink-0 text-xs text-fg-tertiary tabular-nums">{agent.ago}</span>
      </span>
      <span className="flex w-full min-w-0 items-center gap-1.5 pl-5.5 font-mono text-xs text-fg-tertiary">
        <span className="shrink-0">{agent.repo === "." ? WORKSPACE : agent.repo}</span>
        {agent.branch === undefined ? null : (
          <>
            <GitBranch aria-label="branch" className="size-3 shrink-0" />
            <span className="truncate">{agent.branch}</span>
          </>
        )}
      </span>
      <span className="line-clamp-2 pl-5.5 text-sm text-fg-secondary">{agent.excerpt}</span>
    </button>
  );
};

/** The Agents sidebar: every agent, grouped by state with what needs me first. */
export const AgentList = ({ selected }: { selected?: string }) => (
  <div className="flex h-full min-h-0 flex-col">
    <SidebarHeader title="Agents" count={AGENTS.length}>
      <Button variant="secondary" size="sm">
        <Plus />
        New agent
      </Button>
    </SidebarHeader>
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-1 px-1.5 pt-1 pb-3">
        {AGENT_STATE_ORDER.map((stateId) => {
          const agents = AGENTS.filter((agent) => agent.state === stateId);
          if (agents.length === 0) return null;
          return (
            <section key={stateId} aria-label={AGENT_STATES[stateId].label}>
              <h3 className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-xs font-medium text-fg-tertiary">
                <span>{AGENT_STATES[stateId].label}</span>
                <span className="tabular-nums">{agents.length}</span>
              </h3>
              {agents.map((agent) => (
                <AgentRow key={agent.id} agent={agent} selected={agent.id === selected} />
              ))}
            </section>
          );
        })}
      </div>
    </ScrollArea>
  </div>
);
