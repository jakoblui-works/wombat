import { useId } from "react";

import { useNow } from "../../../lib/ago";
import { cn } from "../../../lib/utils";
import { useAgents, useNeedsMeCount, useProposals, useWorkspaces } from "../../../data/hooks.ts";
import { AgentHeadLine, UNDER_TITLE } from "../../agents/AgentHeadLine/AgentHeadLine.tsx";
import { workspaceName } from "../../../data/workspaces.ts";
import { proposalShows } from "../../proposals/proposal-actions.ts";
import { PathText } from "../../proposals/PathText/PathText.tsx";
import { OutsideWorkspace } from "../../proposals/OutsideWorkspace/OutsideWorkspace.tsx";
import { SidebarHeader } from "../../SidebarHeader/SidebarHeader.tsx";
import { AgentsError } from "../../approvals/LogError/LogError.tsx";
import { KIND_ICONS } from "../Chat/ToolCall/ToolCall.tsx";
import { allRows, type NeedsMeRow, type RequestRow } from "./needs-me-rows.ts";
import { useOpenRow } from "./open-row.ts";
import type { ProposalRow } from "./proposal-rows.ts";

const ROW = "focus-ring flex w-full min-w-0 flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-2";

const WorkspaceName = ({ name }: { name: string | undefined }) =>
  name === undefined ? null : <span className="ml-auto shrink-0 pl-2 text-xs text-fg-tertiary">{name}</span>;

/** A request: which agent, what it asks, when, in which workspace. */
const RequestRowView = ({ row, workspace }: { row: RequestRow; workspace: string | undefined }) => {
  const KindIcon = row.kind === undefined ? undefined : KIND_ICONS[row.kind];
  return (
    <>
      <AgentHeadLine state={row.agent.state} title={row.title} ago={row.ago} />
      <span className={cn("flex w-full min-w-0 items-center gap-1.5 text-sm text-fg-secondary", UNDER_TITLE)}>
        {KindIcon === undefined ? null : <KindIcon aria-hidden className="size-3 shrink-0 text-fg-tertiary" />}
        <span className="min-w-0 truncate">{row.ask}</span>
        <WorkspaceName name={workspace} />
      </span>
    </>
  );
};

/** An open proposal: what it changes, whose it is, its age, in which workspace. */
const ProposalRowView = ({ row, workspace }: { row: ProposalRow; workspace: string | undefined }) => {
  const shows = proposalShows(row.proposal.status);
  return (
    <>
      <span className="flex w-full min-w-0 items-center gap-2">
        {row.proposal.target === "file" ? (
          <PathText path={row.label} className="flex-1 text-sm font-medium text-fg-primary" />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-primary">{row.label}</span>
        )}
        {row.kind === undefined ? null : <span className="shrink-0 text-xs text-fg-tertiary">{row.kind}</span>}
        <span className="shrink-0 text-xs text-fg-tertiary tabular-nums">{row.ago}</span>
      </span>
      <span className="flex w-full min-w-0 items-center gap-1.5 text-sm text-fg-secondary">
        <span className="min-w-0 truncate">{row.agentTitle}</span>
        {row.outsideWorkspace ? <OutsideWorkspace /> : null}
        {row.edited ? <span className="shrink-0 text-xs text-fg-tertiary">edited</span> : null}
        {shows.mark === undefined ? null : <span className="shrink-0 text-xs text-fg-tertiary">{shows.mark}</span>}
        <WorkspaceName name={workspace} />
      </span>
    </>
  );
};

const Row = ({ row, workspace, onOpen }: { row: NeedsMeRow; workspace: string | undefined; onOpen: () => void }) => (
  <button type="button" onClick={onOpen} className={ROW}>
    {row.type === "request" ? <RequestRowView row={row} workspace={workspace} /> : <ProposalRowView row={row} workspace={workspace} />}
  </button>
);

/**
 * The top of the left sidebar: every request and open proposal of every workspace, newest first. A click opens where
 * it is decided.
 */
export const NeedsMe = () => {
  const agents = useAgents();
  const proposals = useProposals();
  const workspaces = useWorkspaces().data?.workspaces;
  const openRow = useOpenRow();
  const now = useNow();
  const listed = proposals.data?.proposals ?? [];
  const rows = agents.data === undefined ? undefined : allRows(agents.data.agents, listed, now);
  const count = useNeedsMeCount();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex max-h-1/2 shrink-0 flex-col border-b border-line">
      <SidebarHeader title="Needs me" titleId={titleId} {...(count === undefined ? {} : { count })} />
      {agents.error && rows === undefined ? (
        <AgentsError error={agents.error} />
      ) : rows === undefined ? null : rows.length === 0 ? (
        <p className="px-3 py-3 text-sm text-fg-tertiary">Nothing needs you</p>
      ) : (
        <div className="flex min-h-0 flex-col overflow-y-auto px-1.5 py-1.5">
          {rows.map((row) => (
            <Row key={row.key} row={row} workspace={workspaceName(workspaces, row.workspace)} onOpen={() => openRow(row)} />
          ))}
        </div>
      )}
    </section>
  );
};
