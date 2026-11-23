import type { AgentSummary, Workspace } from "@wombat/shared/api";
import type { FileProposalKind, ItemProposalKind, Proposal, ProposalDetail } from "@wombat/shared/proposals";

import { agentTitle } from "../../lib/agent-title.ts";

/** A proposal's label: a file's full absolute path, an item's `binder/handle` (a create has no handle yet: its `file`, else the binder alone). */
export const proposalLabel = (proposal: Proposal): string => {
  if (proposal.target === "file") return proposal.path;
  const name = proposal.handle ?? proposal.file;
  return name === null ? proposal.binder : `${proposal.binder}/${name}`;
};

/** The proposal tab's label: `proposalLabel`, or for a create with nothing to name it by but its binder, the binder and its proposed title. */
export const proposalTabLabel = (proposal: ProposalDetail): string => {
  if (proposal.target !== "item" || (proposal.handle ?? proposal.file) !== null) return proposalLabel(proposal);
  const title = proposedTitle(proposal.fields);
  return title === undefined ? proposalLabel(proposal) : `${proposal.binder}: ${title}`;
};

/** The title an item proposal's fields set; undefined when they set none, or a blank one. */
export const proposedTitle = (fields: Readonly<Record<string, unknown>>): string | undefined => {
  const title = fields["title"];
  return typeof title === "string" && title.trim() !== "" ? title : undefined;
};

const AGENT_DELETED = "agent deleted";

/** Whose proposal it is: its agent's title, or AGENT_DELETED once the agent is gone from `agents`. */
export const proposalAgentTitle = (
  proposal: Pick<Proposal, "agentId">,
  agents: readonly AgentSummary[],
  workspaces: readonly Pick<Workspace, "id" | "name">[] | undefined,
): string => {
  const agent = agents.find(({ id }) => id === proposal.agentId);
  return agent === undefined ? AGENT_DELETED : agentTitle(agent.id, agent, workspaces);
};

/** Whether the proposal changes a file outside the workspace (an item never is). */
export const isOutsideWorkspace = (proposal: Proposal): boolean => proposal.target === "file" && proposal.outsideWorkspace;

/** The word beside a proposal's label for what it does: a new file, a new item or a delete; undefined for an edit or update. */
export const proposalKindWord = (proposal: Pick<Proposal, "target" | "kind">): "new file" | "new item" | "delete" | undefined => {
  if (proposal.kind === "create") return proposal.target === "file" ? "new file" : "new item";
  return proposal.kind === "delete" ? "delete" : undefined;
};

const MARKS: Record<ItemProposalKind, string> = { create: "New item proposed", update: "Update proposed", delete: "Delete proposed" };

/** What an item proposal shows as, where the item is: a pending row's label, or the mark on the item's row. */
export const markLabel = (kind: ItemProposalKind): string => MARKS[kind];

/** The left side of a file proposal's diff: the file as it is now, empty for a new file or one that can't be read. One rule for the tab's diff and a draft's base. */
export const fileSide = ({ kind, current }: { kind: FileProposalKind; current: string | null }): string => (kind === "create" ? "" : (current ?? ""));

/** A reason's first line, where the place shows only one. */
export const reasonFirstLine = (reason: string): string => reason.trimStart().split(/\r?\n/, 1)[0] ?? "";
