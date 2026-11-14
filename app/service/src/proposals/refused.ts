/** A propose call refused for a reason the agent can act on, which the message states; nothing was stored. */
export class ProposalRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalRefused";
  }
}
