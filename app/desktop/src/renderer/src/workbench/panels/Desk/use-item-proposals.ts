import { useQueries } from "@tanstack/react-query";

import { useProposals } from "../../../data/hooks.ts";
import { proposalQuery } from "../../../data/query-client.ts";
import { type ItemProposalRead, openItemProposals } from "../../items/item-proposals.ts";

/**
 * The binder's open item proposals as `withProposals` takes them: as listed, a create as read on its own (with its
 * fields) once that read is in. Both reads follow the proposal alerts.
 */
export const useItemProposals = (binderId: string): ItemProposalRead[] => {
  const listed = useProposals();
  const open = openItemProposals(listed.data?.proposals ?? [], binderId);
  const creates = open.filter(({ kind }) => kind === "create");
  const details = useQueries({ queries: creates.map(({ id }) => proposalQuery(id)) });
  return open.map((proposal) => {
    const detail = details[creates.indexOf(proposal)]?.data;
    return detail?.target === "item" ? detail : proposal;
  });
};
