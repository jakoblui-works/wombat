// What agents propose and the user decides, for every target. Every propose call ends in `insert`, which owns the
// cap: a call over it is refused before anything is stored. Every approve runs `applying`'s order: the applying
// row with its intent is committed before the target is written, so a service that dies in between settles it at
// the next start from what the target holds.
import { MAX_OPEN_PROPOSALS, type FileProposal, type ProposalDetail, type ProposalStatus } from "@wombat/shared/proposals";

import { openAccess, type Access } from "../items/access.ts";
import { versionOfText } from "../items/files.ts";
import type { ItemsOfWorkspace } from "../items/workspace-items.ts";
import { errorName, type Log } from "../log.ts";
import { currentVersion } from "../store/proposal-rules.ts";
import { fieldsOf, textOf } from "../store/proposals.ts";
import type { ApplyOutcome, ProposalChange, ProposalContent, ProposalForInsert, ProposalVersionHead, Store, StoredProposal } from "../store/store.ts";
import { announcer } from "./announce.ts";
import type { Applied, ApplyTarget, ApproveStep, Written } from "./apply.ts";
import { baseChanged, currentFile, workspaceMark, writeProposed, written } from "./file-target.ts";
import {
  itemProposalOf,
  openItemProposals,
  type ItemProposalDetail,
  type ItemProposalRecord,
  type ItemProposals,
  type ProposalResult,
  type ProposedItemChange,
  type StoredItemProposal,
} from "./item-proposals.ts";
import { noteSource } from "./note-source.ts";
import { fileProposer, heldIn } from "./propose-file.ts";
import { reviser } from "./revise.ts";
import { commonFields } from "./proposal-fields.ts";
import { itemsNotConfiguredIn, notApprovable, notFound, ProposalError, ProposalRefused, toApprove, toReject } from "./refused.ts";

type StoredFileProposal = Extract<StoredProposal, { target: "file" }>;

/** How an approve whose write landed (or not) settles. */
const landedOutcome = (landed: Written | undefined): ApplyOutcome => {
  if (landed === undefined) return { status: "pending" };
  const { itemId, itemHandle } = landed;
  return { status: "approved", ...(itemId === undefined ? {} : { itemId }), ...(itemHandle === undefined ? {} : { itemHandle }) };
};

/** The cap's refusal for an agent with `open` proposals counting toward it, or undefined while there is room. */
const capRefusal = (open: number): string | undefined =>
  open < MAX_OPEN_PROPOSALS
    ? undefined
    : `You have ${String(open)} proposals waiting for the user's decision, and one agent may have at most ${String(MAX_OPEN_PROPOSALS)}. ` +
      "Wait until the user approves or rejects some of them before you propose more; keep working meanwhile.";

/** A stored file proposal as the API sends it. */
const fileProposalOf = (stored: StoredFileProposal, heads: readonly ProposalVersionHead[], outsideWorkspace: boolean): FileProposal => ({
  ...commonFields(stored, heads),
  target: "file",
  path: stored.path,
  outsideWorkspace,
  kind: stored.kind,
});

type ProposalsOptions = {
  store: Store;
  /** The workspace an agent belongs to, which its proposals belong to. Throws AgentError for an unknown agent. */
  workspaceOf: (agentId: string) => string;
  /** A workspace's root (the manager's `rootOf`); a file outside its real path is marked. Throws when there is none. */
  rootOf: (workspaceId: string) => string;
  /** The folder an agent runs in: a relative path it proposes starts there. Throws AgentError when it's gone. */
  agentFolder: (agentId: string) => string;
  /** Called once per committed proposal change, with the seq it took. */
  onProposal: (id: string, seq: number) => void;
  log: Log;
  /** A workspace's item side (its checks, reads and write target), while it has an items folder; asked on every use. */
  itemsOf?: ((workspaceId: string) => ItemProposals | undefined) | undefined;
  /**
   * Whether the items catalog of the workspace or of any listed one holds a file (the item tools change it, never a
   * file proposal); undefined without items.
   */
  holds?: ((realPath: string, workspaceId: string) => Promise<boolean>) | undefined;
  /** Called synchronously at each named step of an approve. */
  onApproveStep?: ((step: ApproveStep) => void) | undefined;
};

/** A file's mark when its workspace's root can't be resolved (unknown, or its folder gone): outside, the warning side. */
const ALL_OUTSIDE = () => true;

export const createProposals = ({ store, workspaceOf, rootOf, agentFolder, onProposal, log, itemsOf, holds, onApproveStep }: ProposalsOptions) => {
  const announce = announcer(onProposal, log);

  /** Announces a committed change; a refused one here means another change got there first. */
  const committed = (id: string, change: ProposalChange | undefined) => {
    if (change === undefined) throw new Error(`Proposal ${id} changed while it was being decided; refresh the proposals and try again.`);
    announce(id, change.seq);
    return change.proposal;
  };

  /** Approvals and rejections one at a time, so a proposal is never applied twice. */
  let deciding: Promise<unknown> = Promise.resolve();
  const decide = <T>(job: () => Promise<T>): Promise<T> => {
    const result = deciding.then(job);
    deciding = result.catch(() => undefined);
    return result;
  };

  const contentOf = (id: string, n: number) => {
    const content = store.getVersion(id, n);
    if (content === undefined) throw new Error(`Proposal ${id} has no version ${String(n)} stored; it can't be read.`);
    return content;
  };

  /** The item side of `workspaceId` as its items are now; ProposalError when it has no items folder. */
  const itemSide = (workspaceId: string) => {
    const items = itemsOf?.(workspaceId);
    if (items === undefined) throw itemsNotConfiguredIn(store, workspaceId);
    return items;
  };

  /** Whether a file's real path is outside the workspace's root, as its root is now. */
  const markOf = async (workspaceId: string) => {
    try {
      return await workspaceMark(rootOf(workspaceId));
    } catch {
      return ALL_OUTSIDE;
    }
  };

  /** The order of every approve, in the decide queue: the current version, the applying commit, the write, the settle. */
  const applying = async (id: string, version: number): Promise<StoredProposal> => {
    const stored = toApprove(store, id, version);
    const target = stored.target === "file" ? fileTarget : itemSide(stored.workspace).itemTarget;
    const { content, reason, by } = contentOf(id, version);
    const { intent, itemHandle } = await target.intentOf(stored, content);
    const begun = store.beginApplying(id, version, intent, itemHandle);
    if (begun === undefined) {
      // Something changed the proposal while the intent was worked out: the refusal says what.
      throw notApprovable(toApprove(store, id, version));
    }
    announce(id, begun.seq);
    onApproveStep?.("after_applying_commit");
    let applied: Applied;
    try {
      applied = await target.write(begun.proposal, content, by);
    } catch (error) {
      // A failure after the write landed (a temp file left behind) must settle approved, or approving again writes twice.
      // When that can't be told, the row stays applying for the next start's check.
      const landed = await target.written(begun.proposal).catch(() => {
        throw error;
      });
      if (landed === undefined) {
        committed(id, store.settle(id, { status: "pending" }));
        throw error;
      }
      log("proposal_landed_after_error", { proposalId: id, error: errorName(error) });
      applied = landed;
    }
    // The write reported that nothing landed: a check that can't tell leaves that report standing.
    if ("retry" in applied) applied = (await target.written(begun.proposal).catch(() => undefined)) ?? applied;
    if ("written" in applied) {
      onApproveStep?.("after_write");
      return committed(id, store.settle(id, landedOutcome(applied)));
    }
    if ("problem" in applied) return committed(id, store.settle(id, { status: "conflict", problem: applied.problem }));
    if ("retry" in applied) return committed(id, store.settle(id, { status: "pending", problem: applied.retry }));
    const { content: next, baseVersion } = applied.revised;
    return committed(id, store.settleRevised(id, next, reason, baseVersion));
  };

  const fileTarget: ApplyTarget = {
    intentOf: (_stored, content) => Promise.resolve({ intent: versionOfText(textOf(content).text) }),
    write: async (stored, content) => {
      if (stored.target !== "file") throw new Error(`Proposal ${stored.id} isn't a file proposal; it can't be written as one.`);
      return writeProposed({ proposal: stored, content: textOf(content), holds: heldIn(holds, stored.workspace) });
    },
    written: async (stored) => (stored.target === "file" && (await written(stored.path, stored.intent)) ? { written: true } : undefined),
  };

  /** `heads` read with `stored`, when the caller has them: a detail's version, versions and text must come from one read. */
  const fileSummary = async (stored: StoredFileProposal, heads = store.listVersionHeads(stored.id)) =>
    fileProposalOf(stored, heads, (await markOf(stored.workspace))(stored.path));

  /** A stored proposal of either target as the API sends it. */
  const summaryOf = async (stored: StoredProposal): Promise<FileProposal | ItemProposalRecord> => {
    if (stored.target === "file") return fileSummary(stored);
    const [item] = await itemSide(stored.workspace).itemProposalsOf([stored]);
    if (item === undefined) throw new Error(`Proposal ${stored.id} couldn't be read as an item proposal.`);
    return item;
  };

  /**
   * Stores a proposal in its agent's workspace, unless the agent is at the cap, and announces it. Synchronous, so no
   * other call stores between the count and the insert.
   */
  const insert = (proposal: ProposalForInsert, firstVersion: ProposalContent): ProposalResult => {
    const refusal = capRefusal(store.countOpen(proposal.agentId));
    if (refusal !== undefined) throw new ProposalRefused(refusal);
    const { proposal: stored, seq } = store.insertProposal({ ...proposal, workspace: workspaceOf(proposal.agentId) }, firstVersion);
    announce(stored.id, seq);
    return { proposed: stored.id };
  };

  const proposeFile = fileProposer({ agentFolder, holdsFor: (agentId) => heldIn(holds, workspaceOf(agentId)), insert });

  /** A proposed item change by `agentId`, checked against its workspace's items and stored once it passed. */
  const proposeItem = async (agentId: string, change: ProposedItemChange, reason: string): Promise<ProposalResult> => {
    const { proposal, fields } = await itemSide(workspaceOf(agentId)).checkItemProposal(agentId, change, reason);
    return insert(proposal, { fields });
  };

  /** The item proposals as the API lists them, each read in its workspace's items; without them, with the handle it stored. */
  const itemRecordsOf = async (rows: readonly StoredItemProposal[]): Promise<ItemProposalRecord[]> => {
    const groups = [...Map.groupBy(rows, (row) => row.workspace)];
    const records = await Promise.all(
      groups.map(async ([workspaceId, inWorkspace]) => {
        const items = itemsOf?.(workspaceId);
        return items === undefined ? inWorkspace.map((row) => itemProposalOf(row, store.listVersionHeads(row.id))) : items.itemProposalsOf(inWorkspace);
      }),
    );
    return records.flat();
  };

  /** Every proposal, or those with `status`, oldest first, as the API lists them. */
  const list = async (status?: ProposalStatus): Promise<(FileProposal | ItemProposalRecord)[]> => {
    const stored = store.listProposals(status);
    const itemRecords = await itemRecordsOf(stored.filter((proposal): proposal is StoredItemProposal => proposal.target === "item"));
    const itemsById = new Map(itemRecords.map((proposal) => [proposal.id, proposal]));
    const fileWorkspaces = [...new Set(stored.flatMap((proposal) => (proposal.target === "file" ? [proposal.workspace] : [])))];
    const marks = new Map(await Promise.all(fileWorkspaces.map(async (workspaceId) => [workspaceId, await markOf(workspaceId)] as const)));
    return stored.flatMap((proposal): (FileProposal | ItemProposalRecord)[] => {
      if (proposal.target === "file") return [fileProposalOf(proposal, store.listVersionHeads(proposal.id), (marks.get(proposal.workspace) ?? ALL_OUTSIDE)(proposal.path))];
      const item = itemsById.get(proposal.id);
      return item === undefined ? [] : [item];
    });
  };

  /** A proposal with its target as it is now and version `version`'s content (default: the current version). */
  const get = async (id: string, version?: number): Promise<ProposalDetail | ItemProposalDetail> => {
    const stored = store.getProposal(id);
    if (stored === undefined) throw notFound(id);
    const heads = store.listVersionHeads(id);
    const n = version ?? currentVersion(heads)?.n ?? 1;
    if (!heads.some((head) => head.n === n)) {
      throw new ProposalError(
        "proposal_not_found",
        `Proposal ${id} has no version ${String(n)}; its versions are ${heads.map((head) => String(head.n)).join(", ")}. Ask for one of those.`,
      );
    }
    if (stored.target === "item") {
      const side = itemSide(stored.workspace);
      return side.itemProposalDetail(stored, fieldsOf(contentOf(id, n).content), heads);
    }
    const { text } = textOf(contentOf(id, n).content);
    const now = await currentFile(stored.path, stored.kind);
    const changed = baseChanged(stored, now);
    return { ...(await fileSummary(stored, heads)), current: now?.text ?? null, text, versions: heads, ...(changed === undefined ? {} : { baseChanged: changed }) };
  };

  /** Approves version `version`, which must be current; a conflict or a new version to approve answers too. */
  const approve = (id: string, version: number): Promise<FileProposal | ItemProposalRecord> => decide(async () => summaryOf(await applying(id, version)));

  /** Rejects a pending proposal or a conflict; nothing is written. */
  const reject = (id: string, reason?: string): Promise<FileProposal | ItemProposalRecord> =>
    decide(async () => {
      const stored = toReject(store, id);
      if (stored.target === "item") itemSide(stored.workspace);
      return summaryOf(committed(id, store.rejectProposal(id, reason)));
    });

  /**
   * Settles every listed proposal a service death left applying, from what its target holds: written with the intent →
   * approved, else pending. Only safe while no approve runs (before the server takes requests, or in the decide queue).
   * An item proposal waits while its workspace has no items folder, and one whose items can't be read waits for the
   * next settle: settling it pending could make a create twice.
   */
  const settleApplying = async (settledEvent: string) => {
    for (const stored of store.listApplying()) {
      const target = stored.target === "file" ? fileTarget : itemsOf?.(stored.workspace)?.itemTarget;
      if (target === undefined) continue;
      let landed: Written | undefined;
      try {
        landed = await target.written(stored);
      } catch (error) {
        log("proposal_settle_failed", { proposalId: stored.id, error: errorName(error) });
        continue;
      }
      const outcome = landedOutcome(landed);
      const change = store.settle(stored.id, outcome);
      if (change === undefined) continue;
      announce(stored.id, change.seq);
      log(settledEvent, { proposalId: stored.id, status: outcome.status });
    }
  };

  /** Run before the server takes requests. */
  const settleAtStart = () => settleApplying("proposal_settled_at_start");

  /** After a workspace adopted proposals stored before workspaces existed: the ones left applying become decidable. */
  const settleAdopted = () => decide(() => settleApplying("proposal_settled_on_adopt"));

  const { revise, putDraft, clearDraft } = reviser({ store, decide, committed, itemsOf, holds, summaryOf });

  return { proposeFile, proposeItem, revise, putDraft, clearDraft, list, get, approve, reject, settleAtStart, settleAdopted };
};

export type Proposals = ReturnType<typeof createProposals>;

type OpenProposalsOptions = Omit<ProposalsOptions, "itemsOf" | "holds"> & {
  /**
   * A workspace's catalog and writer (workspace-items' `of`), asked on every use so a changed items folder is seen;
   * undefined for one without an items folder. Without it no workspace has item tools, and every file is a plain one.
   */
  itemsOf?: ((workspaceId: string) => ItemsOfWorkspace | undefined) | undefined;
};

type ItemSides = { access: Access; itemProposals: ItemProposals };

/**
 * The proposals with everything they work with: per workspace, the item tools' access and the item side of proposals
 * (both undefined without an items folder); the proposals told which files any workspace's items own; and the note
 * source for the agents' next messages.
 */
export const openProposals = ({ itemsOf, ...options }: OpenProposalsOptions) => {
  // One access and item side per opened items, so a reopened items folder gets new ones.
  const sides = new WeakMap<ItemsOfWorkspace, ItemSides>();
  const sidesOf = (workspaceId: string): ItemSides | undefined => {
    const items = itemsOf?.(workspaceId);
    if (items === undefined) return undefined;
    let opened = sides.get(items);
    if (opened === undefined) {
      opened = { access: openAccess(items), itemProposals: openItemProposals({ ...items, store: options.store }) };
      sides.set(items, opened);
    }
    return opened;
  };
  const itemProposalsOf = (workspaceId: string) => sidesOf(workspaceId)?.itemProposals;
  // A file of any workspace's items is changed through that workspace's tools, never a file proposal.
  const holds =
    itemsOf === undefined
      ? undefined
      : async (path: string, workspaceId: string) => {
          for (const id of new Set([workspaceId, ...options.store.listWorkspaces().map((workspace) => workspace.id)])) {
            if ((await itemsOf(id)?.catalog.holds(path)) === true) return true;
          }
          return false;
        };
  const proposals = createProposals({ ...options, itemsOf: itemProposalsOf, holds });
  const notes = noteSource({ store: options.store, itemsOf: itemProposalsOf, log: options.log });
  /** The item tools' access in a workspace, as its items are now; undefined without an items folder. */
  const accessOf = (workspaceId: string) => sidesOf(workspaceId)?.access;
  return { accessOf, proposals, notes };
};
