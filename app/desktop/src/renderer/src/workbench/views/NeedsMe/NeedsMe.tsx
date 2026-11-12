import { useEffect, useState } from "react";

import { ScrollArea } from "../../../components/ui/scroll-area";
import { AGENT_STATES } from "../../../lib/agent-state";
import { cn } from "../../../lib/utils";
import { useAgents } from "../../../data/hooks.ts";
import { SidebarHeader } from "../../SidebarHeader/SidebarHeader.tsx";
import { useWorkbench } from "../../workbench-context.ts";
import { KIND_ICONS } from "../Chat/ToolCall/ToolCall.tsx";
import { type NeedsMeRow, needsMeRows } from "./needs-me-rows.ts";

/** How often the times ("4m") are worked out again. */
const TICK_MS = 60_000;

const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
};

/** One request as a single clickable item: which agent, what it asks, when. Answering happens in the agent's chat. */
const RequestRow = ({ row, onOpen }: { row: NeedsMeRow; onOpen: () => void }) => {
  const state = AGENT_STATES[row.agent?.state ?? "waiting"];
  const KindIcon = row.kind === undefined ? undefined : KIND_ICONS[row.kind];
  return (
    <button type="button" onClick={onOpen} className="focus-ring flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-2">
      <span className="flex w-full items-center gap-2">
        <state.icon aria-label={state.label} className={cn("size-3.5 shrink-0", state.colour)} />
        <span className="min-w-0 flex-1 truncate text-base font-medium text-fg-primary">{row.title}</span>
        <span className="shrink-0 text-xs text-fg-tertiary tabular-nums">{row.ago}</span>
      </span>
      <span className="flex w-full min-w-0 items-center gap-1.5 pl-5.5 text-sm text-fg-secondary">
        {KindIcon === undefined ? null : <KindIcon aria-hidden className="size-3 shrink-0 text-fg-tertiary" />}
        <span className="min-w-0 truncate">{row.ask}</span>
      </span>
    </button>
  );
};

/** The right sidebar: every waiting agent's request, newest first. A click opens the agent's chat at the request. */
export const NeedsMe = () => {
  const agents = useAgents();
  const { openAgentChat } = useWorkbench();
  const now = useNow();
  const rows = agents.data === undefined ? undefined : needsMeRows(agents.data.agents, now);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarHeader title="Needs me" {...(rows === undefined ? {} : { count: rows.length })} />
      {rows === undefined ? null : rows.length === 0 ? (
        <p className="px-3 pt-3 text-sm text-fg-tertiary">Nothing needs you</p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col px-1.5 py-1.5">
            {rows.map((row) => (
              <RequestRow key={row.key} row={row} onOpen={() => openAgentChat(row.agentId, row.requestId)} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
