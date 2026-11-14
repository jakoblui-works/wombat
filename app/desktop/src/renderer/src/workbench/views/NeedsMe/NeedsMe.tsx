import { Button } from "../../../components/ui/button";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { useNow } from "../../../lib/ago";
import { StateMark } from "../../../lib/state-mark";
import { useDecide } from "../../../data/commands.ts";
import { useAgents, useConnection, useProposals } from "../../../data/hooks.ts";
import { needsMeCount } from "../../../data/needs-me.ts";
import { proposalActions } from "../Proposal/proposal-actions.ts";
import { SidebarHeader } from "../../SidebarHeader/SidebarHeader.tsx";
import { useWorkbench } from "../../workbench-context.ts";
import { AgentsError } from "../approvals/LogError/LogError.tsx";
import { KIND_ICONS } from "../Chat/ToolCall/ToolCall.tsx";
import { type NeedsMeRow, needsMeRows } from "./needs-me-rows.ts";
import { type ProposalRow, proposalRows } from "./proposal-rows.ts";

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

/** The path with its file name kept whole: the folders truncate, the DOM text stays complete. */
const PathText = ({ path }: { path: string }) => {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <span className="flex min-w-0 flex-1 text-sm font-medium text-fg-primary">
      <span className="min-w-0 truncate [direction:rtl] [unicode-bidi:plaintext]">{path.slice(0, cut)}</span>
      <span className="shrink-0">{path.slice(cut)}</span>
    </span>
  );
};

/**
 * One open proposal: what it changes, whose it is, its age, and Approve and Reject. Approve names the version this
 * row last read. `onOpen` is the hook for opening the proposal's tab.
 */
const ProposalRowView = ({ row, onOpen }: { row: ProposalRow; onOpen: () => void }) => {
  const connection = useConnection();
  const decide = useDecide();
  const { proposal } = row;
  const actions = proposalActions(proposal, row.agent, connection.state);
  const busy = decide.isPending;
  return (
    <div className="flex flex-col gap-1 rounded-md px-2.5 py-2 transition-colors hover:bg-surface-2">
      <button type="button" onClick={onOpen} className="focus-ring flex w-full min-w-0 flex-col gap-1 rounded-sm text-left">
        <span className="flex w-full min-w-0 items-center gap-2">
          <PathText path={row.label} />
          <span className="shrink-0 text-xs text-fg-tertiary tabular-nums">{row.ago}</span>
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 text-sm text-fg-secondary">
          <span className="min-w-0 truncate">{row.agentTitle}</span>
          {row.outsideWorkspace ? <span className="shrink-0 rounded-sm bg-surface-2 px-1 text-xs text-fg-tertiary">outside workspace</span> : null}
          {proposal.status === "conflict" ? <span className="shrink-0 text-xs text-fg-tertiary">Conflict</span> : null}
          {proposal.status === "applying" ? <span className="shrink-0 text-xs text-fg-tertiary">Applying</span> : null}
        </span>
      </button>
      <div className="flex items-center gap-1.5">
        {proposal.status === "conflict" ? null : (
          <Button type="button" variant="secondary" size="xs" disabled={!actions.approve || busy} onClick={() => decide.mutate({ proposalId: proposal.id, decision: "approve", version: proposal.version })}>
            Approve
          </Button>
        )}
        <Button type="button" variant="secondary" size="xs" disabled={!actions.reject || busy} onClick={() => decide.mutate({ proposalId: proposal.id, decision: "reject" })}>
          Reject
        </Button>
      </div>
      {decide.error ? <p role="alert" className="text-xs text-destructive">{decide.error.message}</p> : null}
    </div>
  );
};

/** The right sidebar: every waiting agent's request, newest first. A click opens the agent's chat at the request. */
export const NeedsMe = () => {
  const agents = useAgents();
  const { openAgentChat } = useWorkbench();
  const proposals = useProposals();
  const now = useNow();
  const rows = agents.data === undefined ? undefined : needsMeRows(agents.data.agents, now);
  const proposalList = agents.data === undefined ? [] : proposalRows(proposals.data?.proposals ?? [], agents.data.agents, now);
  const count = agents.data === undefined ? undefined : needsMeCount(agents.data.agents, proposals.data?.proposals ?? []);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarHeader title="Needs me" {...(count === undefined ? {} : { count })} />
      {agents.error && rows === undefined ? (
        <AgentsError error={agents.error} />
      ) : rows === undefined ? null : rows.length === 0 ? (
        <p className="px-3 pt-3 text-sm text-fg-tertiary">Nothing needs you</p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col px-1.5 py-1.5">
            {rows.map((row) => (
              <RequestRow key={row.key} row={row} onOpen={() => openAgentChat(row.agentId, row.requestId)} />
            ))}
            {proposalList.length === 0 ? null : (
              <section className="flex flex-col">
                <h3 className="px-2.5 pt-3 pb-1 text-xs font-semibold text-fg-tertiary">Proposals</h3>
                {proposalList.map((row) => (
                  // Opening the proposal's tab is not built yet.
                  <ProposalRowView key={row.key} row={row} onOpen={() => undefined} />
                ))}
              </section>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
