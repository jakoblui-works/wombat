import type { Proposal } from "@wombat/shared/proposals";

import { Button } from "../../../components/ui/button";
import { useDecide } from "../../../data/commands.ts";
import { useHarnessFeatures } from "../../../data/harness-features.ts";
import { useAgents, useConnection } from "../../../data/hooks.ts";
import { cn } from "../../../lib/utils";
import { AnswerError } from "../../panels/approvals/Answer/Answer.tsx";
import { useWorkbench } from "../../workbench-context.ts";
import { proposalActions, proposalShows } from "../proposal-actions.ts";

/**
 * A proposal's Approve and Reject where it shows in place (a row, a card, the item tab's banner), and its state in
 * place of Approve while it can't be approved. Approve names the version this place last read; one that meets a newer
 * version opens the proposal's tab instead, so it's seen first. Reject sends no reason. Without `mark`, the state isn't
 * named here (the place names it itself).
 */
export const DecideButtons = ({
  proposal,
  className,
  tabIndex,
  mark = true,
}: {
  proposal: Proposal;
  className?: string;
  tabIndex?: number | undefined;
  mark?: boolean;
}) => {
  const agents = useAgents();
  const connection = useConnection();
  const decide = useDecide();
  const { openProposal } = useWorkbench();
  const agent = agents.data?.agents.find(({ id }) => id === proposal.agentId);
  const actions = proposalActions(proposal, agent, connection.state, useHarnessFeatures(agent?.harness));
  const shows = proposalShows(proposal.status);
  const busy = decide.isPending;
  const approve = () =>
    decide.mutate({ proposalId: proposal.id, decision: "approve", version: proposal.version }, { onSuccess: (result) => result === "changed" && openProposal(proposal.id) });
  return (
    <>
      <span className={cn("flex items-center gap-1.5", className)}>
        {!mark || shows.mark === undefined ? null : <span className="text-xs font-medium text-state-waiting">{shows.mark}</span>}
        {shows.approve ? (
          <Button type="button" variant="secondary" size="xs" tabIndex={tabIndex} disabled={!actions.approve || busy} onClick={approve}>
            Approve
          </Button>
        ) : null}
        {shows.reject ? (
          <Button
            type="button"
            variant="secondary"
            size="xs"
            tabIndex={tabIndex}
            disabled={!actions.reject || busy}
            onClick={() => decide.mutate({ proposalId: proposal.id, decision: "reject" })}
          >
            Reject
          </Button>
        ) : null}
      </span>
      <AnswerError error={decide.error ?? undefined} className="rounded-sm px-0 py-0.5 text-xs" />
    </>
  );
};
