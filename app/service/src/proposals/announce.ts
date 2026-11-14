import type { Log } from "../log.ts";

/** Announces a committed proposal change; a failing listener never makes the committed change look failed. */
export const announcer =
  (onProposal: (id: string, seq: number) => void, log: Log) =>
  (id: string, seq: number): void => {
    try {
      onProposal(id, seq);
    } catch (error) {
      log("proposal_alert_failed", { proposalId: id, seq, error: error instanceof Error ? error.name : "unknown" });
    }
  };
