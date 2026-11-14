// An agent's proposed item changes, and the user's decisions on them. A proposal runs the same checks as the
// direct change before anything is stored. Approving applies a proposal through the writer on the version the
// agent read, under the structure's settings as they are now; anything changed since makes it a conflict, never
// an overwrite.
import { ItemWriteErrorCode } from "@wombat/shared/api";
import type { Problem } from "@wombat/shared/items";
import { canDecide, ProposalErrorCode, type ItemProposal, type ProposalStatus } from "@wombat/shared/proposals";

import type { View } from "../items/access.ts";
import type { Catalog, LoadedItem, Snapshot, ValidStructure } from "../items/catalog.ts";
import { checkHasId, checkLevel, checkLocks, lockedNames, newItem, type Family, type ItemInput } from "../items/refusals.ts";
import { SETTINGS_FILE } from "../items/structures.ts";
import { ItemWriteError, presentValues, type Writer } from "../items/write.ts";
import type { Log } from "../log.ts";
import type { NewProposal, ProposalChange, Store, StoredProposal } from "../store/store.ts";
import { announcer } from "./announce.ts";
import { commonFields } from "./proposal-fields.ts";

/** Why deciding a proposal was refused; nothing changed. */
export class ProposalError extends Error {
  readonly code: ProposalErrorCode;

  constructor(code: ProposalErrorCode, message: string) {
    super(message);
    this.name = "ProposalError";
    this.code = code;
  }
}

export type ProposalResult = { proposed: string };

/** An item proposal as sent, with what its current version proposes, for the service's own callers. */
export type ItemProposalRecord = ItemProposal & { fields: Record<string, unknown>; baseVersion: string | null };

type StoredItemProposal = Extract<StoredProposal, { target: "item" }>;
type NewItemProposal = Omit<Extract<NewProposal, { target: "item" }>, "target" | "path">;

const isItemProposal = (stored: StoredProposal): stored is StoredItemProposal => stored.target === "item";

export type ItemProposals = {
  proposeCreate(agentId: string, structureId: string, input: ItemInput, reason: string): Promise<ProposalResult>;
  proposeUpdate(agentId: string, handle: string, fields: Record<string, unknown>, version: string, reason: string): Promise<ProposalResult>;
  proposeDelete(agentId: string, handle: string, version: string, reason: string): Promise<ProposalResult>;
  /** For people (HTTP): every proposal, hidden structures' included, or those with `status`. */
  proposals(status?: ProposalStatus): Promise<ItemProposalRecord[]>;
  /** Applies a pending proposal through the writer; a conflict answers with `status: "conflict"` and its problem. */
  approve(id: string): Promise<ItemProposalRecord>;
  /** Marks a pending proposal rejected; no file is touched. */
  reject(id: string): Promise<ItemProposalRecord>;
};

/** The view functions come from access.ts, which alone decides what an agent may read about a structure. */
export type ItemProposalsOptions = {
  catalog: Catalog;
  writer: Writer;
  store: Store;
  /** Called after every proposal write (stored or decided) is committed, with the seq it took. */
  onProposal: (id: string, seq: number) => void;
  log: Log;
  viewOf: (snapshot: Snapshot) => View;
  structureFor: (view: View, id: string) => ValidStructure;
  itemFor: (view: View, handle: string) => { item: LoadedItem; structure: ValidStructure; handle: string };
  checkStructure: (view: View, structure: ValidStructure) => void;
  linksToIds: (view: View, structure: ValidStructure, values: Record<string, unknown>) => Record<string, unknown>;
  checkNewFile: (view: View, structure: ValidStructure, file: unknown, family: Family) => Promise<void>;
  agentWriteError: (view: View, error: unknown, subject: { handle?: string; structure: ValidStructure }) => unknown;
};

export const openItemProposals = ({
  catalog,
  writer,
  store,
  onProposal,
  log,
  viewOf,
  structureFor,
  itemFor,
  checkStructure,
  linksToIds,
  checkNewFile,
  agentWriteError,
}: ItemProposalsOptions): ItemProposals => {
  const view = async () => viewOf(await catalog.snapshot());

  const announce = announcer(onProposal, log);

  /** Stores a proposal and announces it once committed. */
  const propose = (proposal: NewItemProposal, fields: Record<string, unknown>): ProposalResult => {
    const { proposal: stored, seq } = store.insertProposal({ ...proposal, target: "item", path: null }, { fields });
    announce(stored.id, seq);
    return { proposed: stored.id };
  };

  const currentVersion = (id: string) => {
    const versions = store.listVersions(id);
    const latest = versions.at(-1);
    if (latest === undefined || !("fields" in latest.content)) throw new Error(`Proposal ${id} has no item version stored; it can't be read.`);
    return { n: latest.n, fields: latest.content.fields, versions };
  };

  /** A stored proposal with its item's current handle (people see hidden structures too). */
  const proposalOf = (stored: StoredItemProposal, items: LoadedItem[], handle?: string | null): ItemProposalRecord => {
    const { itemId } = stored;
    const found = itemId === null ? undefined : items.find((item) => item.id === itemId);
    const { fields, versions } = currentVersion(stored.id);
    return {
      ...commonFields(stored, versions),
      target: "item",
      structure: stored.structure,
      kind: stored.kind,
      handle: handle !== undefined ? handle : (found?.handle ?? null),
      file: stored.file,
      fields,
      baseVersion: stored.baseVersion,
    };
  };

  /** Approvals and rejections one at a time, so a proposal is never applied twice. */
  let deciding: Promise<unknown> = Promise.resolve();
  const decide = <T>(job: () => Promise<T>): Promise<T> => {
    const result = deciding.then(job);
    deciding = result.catch(() => undefined);
    return result;
  };

  const pending = (id: string) => {
    const stored = store.getProposal(id);
    if (stored === undefined || !isItemProposal(stored)) throw new ProposalError(ProposalErrorCode.enum.proposal_not_found, `No proposal has the id ${id}. Refresh the proposals to see the current ones.`);
    if (!canDecide(stored.status)) {
      throw new ProposalError(
        ProposalErrorCode.enum.proposal_not_pending,
        `Proposal ${id} is already ${stored.status}; only a pending proposal can be approved or rejected. Refresh the proposals to see its state.`,
      );
    }
    return stored;
  };

  /** Announces a committed move; only a move racing another (they're serialized here) finds it refused. */
  const moved = (id: string, change: ProposalChange | undefined) => {
    if (change === undefined || !isItemProposal(change.proposal)) throw new Error(`Proposal ${id} changed while it was being decided; refresh the proposals and try again.`);
    announce(id, change.seq);
    return change.proposal;
  };

  /** Applies a pending proposal, or says why it can't be: what changed since the agent read the item. */
  const apply = async (stored: StoredItemProposal, fields: Record<string, unknown>, snapshot: Snapshot): Promise<{ problem: Problem } | { created?: LoadedItem }> => {
    const conflict = (message: string, field?: string) => ({ problem: { ...(field === undefined ? {} : { field }), message } });
    const view = viewOf(snapshot);
    const structure = view.structures.get(stored.structure);
    const access = view.hiddenStructures.has(stored.structure) ? "hidden" : structure?.settings.access;
    if (access === "hidden" || access === "read") {
      return conflict(`${stored.structure} is now ${access}, so agents' changes no longer apply to it and nothing was applied. Make the change by hand if you still want it.`, "access");
    }
    if (structure === undefined) {
      return conflict(`The structure ${stored.structure} is gone, or its ${SETTINGS_FILE} is broken, so nothing was applied. Fix its settings and ask the agent again, or reject the proposal.`);
    }
    const locked = lockedNames(structure, stored.kind, Object.keys(fields));
    if (locked.length > 0) {
      return conflict(`${locked.join(", ")} became locked in ${stored.structure}, so nothing was applied. Make the change by hand if you still want it.`, locked[0]);
    }

    try {
      if (stored.kind === "create") {
        const { title, body, ...properties } = fields;
        const input = { title: title as string, ...(typeof body === "string" ? { body } : {}), ...(stored.file === null ? {} : { file: stored.file }) };
        const created = await writer.createItem(structure.id, newItem(input, properties));
        return { created };
      }
      const item = stored.itemId === null ? undefined : snapshot.items.find((candidate) => candidate.id === stored.itemId);
      if (item?.handle == null) return conflict("The item was deleted, or its id changed by hand, since the agent read it, so nothing was applied. Reject the proposal, or ask the agent to read the item again.");
      if (item.structure !== stored.structure) return conflict(`The item moved to ${item.structure} since the agent read it, so nothing was applied. Reject the proposal, or ask the agent again.`);
      const baseVersion = stored.baseVersion ?? "";
      if (stored.kind === "update") await writer.updateItem(item.handle, fields, baseVersion);
      else await writer.deleteItem(item.handle, baseVersion);
      return {};
    } catch (error) {
      if (!(error instanceof ItemWriteError) || error.code === ItemWriteErrorCode.enum.items_not_writable) throw error;
      if (error.code === ItemWriteErrorCode.enum.stale_version || error.code === ItemWriteErrorCode.enum.item_not_found) {
        return conflict(`The item changed (edited, renamed or deleted) since the agent read it, so nothing was applied. Reject the proposal, or ask the agent to read the item again and propose anew.`);
      }
      const [only] = error.problems;
      return conflict(error.message, error.problems.length === 1 ? only?.field : undefined);
    }
  };

  // An approval cut off (a crash, a failed settle) would leave its proposal applying, so it could never be approved
  // or rejected again; the write is assumed not to have happened.
  for (const stored of store.listApplying().filter(isItemProposal)) {
    const change = store.settle(stored.id, { status: "pending" });
    if (change !== undefined) announce(stored.id, change.seq);
  }

  return {
    proposeCreate: async (agentId, structureId, input, reason) => {
      const current = await view();
      const structure = structureFor(current, structureId);
      checkLevel(structure, "propose", "create");
      const properties = input.properties ?? {};
      checkLocks(structure, "create", Object.keys(properties));
      const linked = presentValues(linksToIds(current, structure, properties));
      checkStructure(current, structure);
      await checkNewFile(current, structure, input.file, "propose");
      try {
        await writer.check({ kind: "create", structureId: structure.id, item: newItem(input, linked), unseen: current.hiddenFolders });
      } catch (error) {
        throw agentWriteError(current, error, { structure });
      }

      return propose(
        { structure: structure.id, itemId: null, kind: "create", file: input.file ?? null, reason, baseVersion: null, agentId },
        { title: input.title, ...(input.body === undefined ? {} : { body: input.body }), ...linked },
      );
    },

    proposeUpdate: async (agentId, handle, fields, version, reason) => {
      const current = await view();
      const { item, structure, handle: target } = itemFor(current, handle);
      checkLevel(structure, "propose", "update");
      checkLocks(structure, "update", Object.keys(fields));
      checkStructure(current, structure);
      const linked = linksToIds(current, structure, fields);
      try {
        await writer.check({ kind: "update", handle: target, fields: linked, baseVersion: version });
      } catch (error) {
        throw agentWriteError(current, error, { handle, structure });
      }
      return propose({ structure: structure.id, itemId: item.id, kind: "update", file: null, reason, baseVersion: version, agentId }, linked);
    },

    proposeDelete: async (agentId, handle, version, reason) => {
      const current = await view();
      const { item, structure, handle: target } = itemFor(current, handle);
      checkLevel(structure, "propose", "delete");
      checkStructure(current, structure);
      checkHasId(item, target);
      try {
        await writer.check({ kind: "delete", handle: target, baseVersion: version });
      } catch (error) {
        throw agentWriteError(current, error, { handle, structure });
      }
      return propose({ structure: structure.id, itemId: item.id, kind: "delete", file: null, reason, baseVersion: version, agentId }, {});
    },

    proposals: async (status) => {
      const { items } = await catalog.snapshot();
      return store.listProposals(status).filter(isItemProposal).map((stored) => proposalOf(stored, items));
    },

    approve: (id) =>
      decide(async () => {
        const stored = pending(id);
        const snapshot = await catalog.snapshot();
        const { n, fields } = currentVersion(id);
        moved(id, store.beginApplying(id, n, { kind: stored.kind, itemId: stored.itemId, version: n }));
        let outcome: Awaited<ReturnType<typeof apply>>;
        try {
          outcome = await apply(stored, fields, snapshot);
        } catch (error) {
          const failed = store.settle(id, { status: "pending" });
          if (failed !== undefined) announce(id, failed.seq);
          throw error;
        }
        if ("problem" in outcome) return proposalOf(moved(id, store.settle(id, { status: "conflict", problem: outcome.problem })), snapshot.items);
        const { created } = outcome;
        const itemId = created?.id ?? undefined;
        const approved = moved(id, store.settle(id, { status: "approved", ...(itemId === undefined ? {} : { itemId }) }));
        return proposalOf(approved, snapshot.items, created?.handle);
      }),

    reject: (id) =>
      decide(async () => {
        pending(id);
        const { items } = await catalog.snapshot();
        return proposalOf(moved(id, store.rejectProposal(id)), items);
      }),
  };
};
