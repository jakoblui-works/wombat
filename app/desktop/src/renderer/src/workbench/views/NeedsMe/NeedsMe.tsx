import { ScrollArea } from "../../../components/ui/scroll-area";
import { useNow } from "../../../lib/ago";
import { StateMark } from "../../../lib/state-mark";
import { useAgents } from "../../../data/hooks.ts";
import { SidebarHeader } from "../../SidebarHeader/SidebarHeader.tsx";
import { useWorkbench } from "../../workbench-context.ts";
import { KIND_ICONS } from "../Chat/ToolCall/ToolCall.tsx";
import { type NeedsMeRow, needsMeRows } from "./needs-me-rows.ts";

/** One request as a single clickable item: which agent, what it asks, when. Answering happens in the agent's chat. */
const RequestRow = ({ row, onOpen }: { row: NeedsMeRow; onOpen: () => void }) => {
  const KindIcon = row.kind === undefined ? undefined : KIND_ICONS[row.kind];
  return (
    <button type="button" onClick={onOpen} className="focus-ring flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-2">
      <span className="flex w-full items-center gap-2">
        <StateMark state={row.agent?.state ?? "waiting"} />
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
      {agents.error && rows === undefined ? (
        <p role="alert" className="px-3 pt-3 text-sm text-danger">
          Couldn't read the agents: {agents.error.message}
        </p>
      ) : rows === undefined ? null : rows.length === 0 ? (
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
