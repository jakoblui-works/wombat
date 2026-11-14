import type { Proposal } from "@wombat/shared/proposals";

/** A proposal's label: a file's full absolute path, an item's `structure/handle` (a create has no handle yet: its `file`, else the structure alone). */
export const proposalLabel = (proposal: Proposal): string => {
  if (proposal.target === "file") return proposal.path;
  const name = proposal.handle ?? proposal.file;
  return name === null ? proposal.structure : `${proposal.structure}/${name}`;
};
