import type { ItemProposal } from "@wombat/shared/proposals";

import { Button } from "../../../../components/ui/button";
import { useAgents } from "../../../../data/hooks.ts";
import { agentTitle } from "../../../../lib/agent-title.ts";
import { DecideButtons } from "../../../proposals/DecideButtons/DecideButtons.tsx";
import { reasonFirstLine } from "../../../proposals/proposal-label.ts";
import { useWorkbench } from "../../../workbench-context.ts";
import { markLabel } from "../../Desk/view-model/with-proposals.ts";

const PROPOSES = { create: "proposes this item", update: "proposes an update to this item", delete: "proposes to delete this item" } as const;

/** An open proposal on the item its tab shows: whose, what it does and why (the reason's first line), and its decision. */
export const ProposalBanner = ({ proposal }: { proposal: ItemProposal }) => {
  const agents = useAgents();
  const { openProposal } = useWorkbench();
  const by = agentTitle(proposal.agentId, agents.data?.agents.find(({ id }) => id === proposal.agentId));
  return (
    <section aria-label={markLabel(proposal.kind)} className="flex flex-col gap-2 rounded-md border border-primary/30 bg-surface-2 px-3 py-2.5 text-sm text-fg-secondary">
      <p>
        <span className="font-medium text-fg-primary">{by}</span> {PROPOSES[proposal.kind]}
      </p>
      <p className="text-fg-primary">{reasonFirstLine(proposal.reason)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <DecideButtons proposal={proposal} />
        <Button type="button" variant="ghost" size="xs" onClick={() => openProposal(proposal.id)}>
          Open the diff
        </Button>
      </div>
    </section>
  );
};
