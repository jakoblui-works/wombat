// Reads what an agent's next message tells it about its proposals; writes nothing. Labels need the items as they are
// now (an item's handle), so they are read before the message is stored; everything else is read again, synchronously,
// in the step that stores it, so an outcome told by another message meanwhile is not told twice.
import { errorName, type Log } from "../log.ts";
import type { Store, StoredProposal } from "../store/store.ts";
import type { ItemProposals, StoredItemProposal } from "./item-proposals.ts";
import { itemLabel, noteFor, type NoteSubject, type ProposalNote } from "./note.ts";
import { notFound, ownOpenProposal } from "./refused.ts";

/** What `prepare` read: each proposal's label, and the message's proposal while it was the agent's open one. */
export type PreparedNote = { labels: ReadonlyMap<string, string>; outcomes: readonly string[]; reference: string | undefined };

/** The note to store with a message, and the outcomes it delivers. */
export type MessageNote = { note: ProposalNote | undefined; delivers: string[] };

export type NoteSourceOptions = {
  store: Pick<Store, "undeliveredOutcomes" | "getProposal" | "listVersions">;
  /** The item side, to label an item proposal by a handle the agent may see; without it items get a neutral label. */
  items?: Pick<ItemProposals, "agentHandlesOf"> | undefined;
  log?: Log | undefined;
};

export const noteSource = ({ store, items, log }: NoteSourceOptions) => {
  const handlesOf = async (stored: readonly StoredProposal[]): Promise<ReadonlyMap<string, string>> => {
    const itemRows = stored.filter((proposal): proposal is StoredItemProposal => proposal.target === "item");
    if (items === undefined || itemRows.length === 0) return new Map();
    try {
      return await items.agentHandlesOf(itemRows);
    } catch (error) {
      // The items can't be read now: the message still goes, its items labelled without a handle.
      log?.("note_handles_failed", { error: errorName(error) });
      return new Map();
    }
  };

  const diffFailed = (proposalId: string, error: unknown) => {
    log?.("note_diff_failed", { proposalId, error: errorName(error) });
  };

  /** Reads the labels for a message from `agentId` about `proposalId`. */
  const prepare = async (agentId: string, proposalId: string | undefined): Promise<PreparedNote> => {
    const outcomes = store.undeliveredOutcomes(agentId);
    const own = proposalId === undefined ? undefined : ownOpenProposal(store, agentId, proposalId);
    const subjects = own === undefined ? outcomes : [...outcomes, own];
    const handles = await handlesOf(subjects);
    const labels = new Map(subjects.map((stored) => [stored.id, stored.target === "file" ? stored.path : itemLabel(stored.kind, handles.get(stored.id))]));
    return { labels, outcomes: outcomes.map(({ id }) => id), reference: own?.id };
  };

  const subjectOf = (stored: StoredProposal, labels: ReadonlyMap<string, string>): NoteSubject | undefined => {
    const label = labels.get(stored.id);
    return label === undefined ? undefined : { stored, versions: store.listVersions(stored.id), label };
  };

  /**
   * The note as it stands now, for the step that stores the message: the outcomes prepared that are still untold, and
   * the reference. Throws ProposalError `proposal_not_found` when `proposalId` isn't the agent's open proposal.
   */
  const current = (agentId: string, proposalId: string | undefined, prepared: PreparedNote): MessageNote => {
    const own = proposalId === undefined ? undefined : ownOpenProposal(store, agentId, proposalId);
    if (proposalId !== undefined && (own === undefined || prepared.reference !== own.id)) throw notFound(proposalId);
    const untold = store.undeliveredOutcomes(agentId).filter(({ id }) => prepared.outcomes.includes(id));
    const subjects = untold.flatMap((stored) => subjectOf(stored, prepared.labels) ?? []);
    const note = noteFor(subjects, own === undefined ? undefined : subjectOf(own, prepared.labels), diffFailed);
    return { note, delivers: note?.outcomes.map(({ proposalId: id }) => id) ?? [] };
  };

  return { prepare, current };
};

export type NoteSource = ReturnType<typeof noteSource>;
