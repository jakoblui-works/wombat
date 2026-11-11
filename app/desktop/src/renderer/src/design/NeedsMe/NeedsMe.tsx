import { Pencil, Terminal } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { AGENT_STATES } from "@/lib/agent-state";
import { cn } from "@/lib/utils";
import { agentById, type DesignRequest, REQUESTS } from "../fixtures.ts";
import { SidebarHeader } from "../SidebarHeader/SidebarHeader.tsx";

const KIND_ICONS = { edit: Pencil, execute: Terminal } as const;

/** One request as a single clickable item: which agent, what it asks, when. Answering happens in the agent's chat. */
const RequestRow = ({ request }: { request: DesignRequest }) => {
  const agent = agentById(request.agentId);
  const state = AGENT_STATES[agent.state];
  const KindIcon = KIND_ICONS[request.kind];
  return (
    <button type="button" className="focus-ring flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-2">
      <span className="flex w-full items-center gap-2">
        <state.icon aria-label={state.label} className={cn("size-3.5 shrink-0", state.colour)} />
        <span className="min-w-0 flex-1 truncate text-base font-medium text-fg-primary">{agent.title}</span>
        <span className="shrink-0 text-xs text-fg-tertiary tabular-nums">{request.ago}</span>
      </span>
      <span className="flex w-full min-w-0 items-center gap-1.5 pl-5.5 text-sm text-fg-secondary">
        <KindIcon className="size-3 shrink-0 text-fg-tertiary" />
        <span className="shrink-0">{request.ask}</span>
        <code className="truncate font-mono text-xs text-fg-primary">{request.target}</code>
      </span>
    </button>
  );
};

/** The right sidebar: every waiting agent's request, newest first. */
export const NeedsMe = () => (
  <div className="flex h-full min-h-0 flex-col">
    <SidebarHeader title="Needs me" count={REQUESTS.length} />
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col px-1.5 py-1.5">
        {REQUESTS.map((request) => (
          <RequestRow key={request.id} request={request} />
        ))}
      </div>
    </ScrollArea>
  </div>
);
