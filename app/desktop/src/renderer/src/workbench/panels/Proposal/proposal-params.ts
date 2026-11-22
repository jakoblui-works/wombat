// The proposal tab's params and when it applies, pure (the registry, the restore and the live prune read them).
import { z } from "zod";

import { isOpen, type Proposal } from "@wombat/shared/proposals";

export const ProposalParams = z.object({ proposalId: z.string() });
export type ProposalParams = z.infer<typeof ProposalParams>;

/** The proposal panel's id: its registration and every tab opened on it. */
export const PROPOSAL_PANEL = "proposal";

/** The tab's title until its panel has read the proposal (it reports the proposal's label). */
export const PROPOSAL_TITLE = "Proposal";

/** What the proposal tab's rules look at: the proposals as the service lists them, undefined until they're read. */
type ProposalsContext = { proposals: readonly Pick<Proposal, "id" | "status">[] | undefined };

/** The tab's proposal: "unknown" while the proposals aren't read, undefined when the service doesn't list it. */
const listed = (params: unknown, { proposals }: ProposalsContext): Pick<Proposal, "id" | "status"> | "unknown" | undefined => {
  const parsed = ProposalParams.safeParse(params);
  if (!parsed.success) return undefined;
  return proposals === undefined ? "unknown" : proposals.find(({ id }) => id === parsed.data.proposalId);
};

/**
 * While the app runs, a proposal tab applies while its proposal exists: a decided one shows its outcome. Until the
 * proposals are read, it's kept.
 */
export const proposalResolves = (params: unknown, ctx: ProposalsContext): boolean => listed(params, ctx) !== undefined;

/** At the next start, a proposal tab comes back only while its proposal is open (kept when they couldn't be read). */
export const proposalRestores = (params: unknown, ctx: ProposalsContext): boolean => {
  const proposal = listed(params, ctx);
  return proposal === "unknown" || (proposal !== undefined && isOpen(proposal.status));
};

/** Whether `tab` (the active tab, say) is the proposal tab of `proposalId`. */
export const isProposalTab = (tab: { panelId: string; params: unknown } | undefined, proposalId: string): boolean => {
  if (tab?.panelId !== PROPOSAL_PANEL) return false;
  const parsed = ProposalParams.safeParse(tab.params);
  return parsed.success && parsed.data.proposalId === proposalId;
};
