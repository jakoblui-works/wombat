// What agents propose and the user decides, for every target. Every propose call ends in `insert`, which owns the
// cap: a call over it is refused before anything is stored. Every approve runs `applying`'s order: the applying
// row with its intent is committed before the target is written, so a service that dies in between settles it at
// the next start from what the target holds.
import { MAX_OPEN_PROPOSALS, type FileProposal, type ProposalDetail, type ProposalStatus } from "@wombat/shared/proposals";

import { openAccess } from "../items/access.ts";
import type { Catalog } from "../items/catalog.ts";
import { versionOfText } from "../items/files.ts";
import type { Writer } from "../items/write.ts";
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
import { fileProposer } from "./propose-file.ts";
import { reviser } from "./revise.ts";
import { commonFields } from "./proposal-fields.ts";
import { itemsNotConfigured, notApprovable, notFound, ProposalError, ProposalRefused, toApprove, toReject } from "./refused.ts";

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
  /** The workspace root; a file outside its real path is marked. */
  workspace: string;
  /** The id of that workspace, which every new proposal belongs to. */
  workspaceId: string;
  /** The folder an agent runs in: a relative path it proposes starts there. Throws AgentError when it's gone. */
  agentFolder: (agentId: string) => string;
  /** Called once per committed proposal change, with the seq it took. */
  onProposal: (id: string, seq: number) => void;
  log: Log;
  /** The item side (its checks, reads and write target), while items are set up. */
  items?: ItemProposals | undefined;
  /** Whether the items catalog holds a file (the item tools change it, never a file proposal); undefined without items. */
  holds?: ((realPath: string) => Promise<boolean>) | undefined;
  /** Called synchronously at each named step of an approve. */
  onApproveStep?: ((step: ApproveStep) => void) | undefined;
};

export const createProposals = ({ store, workspace, workspaceId, agentFolder, onProposal, log, items, holds, onApproveStep }: ProposalsOptions) => {
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

  const itemSide = () => {
    if (items === undefined) throw itemsNotConfigured();
    return items;
  };

  /** The order of every approve, in the decide queue: the current version, the applying commit, the write, the settle. */
  const applying = async (id: string, version: number): Promise<StoredProposal> => {
    const stored = toApprove(store, id, version);
    const target = stored.target === "file" ? fileTarget : itemSide().itemTarget;
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
      return writeProposed({ proposal: stored, content: textOf(content), holds });
    },
    written: async (stored) => (stored.target === "file" && (await written(stored.path, stored.intent)) ? { written: true } : undefined),
  };

  /** `heads` read with `stored`, when the caller has them: a detail's version, versions and text must come from one read. */
  const fileSummary = async (stored: StoredFileProposal, heads = store.listVersionHeads(stored.id)) => fileProposalOf(stored, heads, (await workspaceMark(workspace))(stored.path));

  /** A stored proposal of either target as the API sends it. */
  const summaryOf = async (stored: StoredProposal): Promise<FileProposal | ItemProposalRecord> => {
    if (stored.target === "file") return fileSummary(stored);
    const [item] = await itemSide().itemProposalsOf([stored]);
    if (item === undefined) throw new Error(`Proposal ${stored.id} couldn't be read as an item proposal.`);
    return item;
  };

  /** Stores a proposal, unless its agent is at the cap, and announces it. Synchronous, so no other call stores between the count and the insert. */
  const insert = (proposal: ProposalForInsert, firstVersion: ProposalContent): ProposalResult => {
    const refusal = capRefusal(store.countOpen(proposal.agentId));
    if (refusal !== undefined) throw new ProposalRefused(refusal);
    const { proposal: stored, seq } = store.insertProposal({ ...proposal, workspace: workspaceId }, firstVersion);
    announce(stored.id, seq);
    return { proposed: stored.id };
  };

  const proposeFile = fileProposer({ agentFolder, holds, insert });

  /** A proposed item change by `agentId`, stored once it passed its checks. */
  const proposeItem = async (agentId: string, change: ProposedItemChange, reason: string): Promise<ProposalResult> => {
    const { proposal, fields } = await itemSide().checkItemProposal(agentId, change, reason);
    return insert(proposal, { fields });
  };

  /** Every proposal, or those with `status`, oldest first, as the API lists them; without items an item proposal names the handle it stored. */
  const list = async (status?: ProposalStatus): Promise<(FileProposal | ItemProposalRecord)[]> => {
    const stored = store.listProposals(status);
    const itemRows = stored.filter((proposal): proposal is StoredItemProposal => proposal.target === "item");
    const itemRecords = items === undefined ? itemRows.map((row) => itemProposalOf(row, store.listVersionHeads(row.id))) : await items.itemProposalsOf(itemRows);
    const itemsById = new Map(itemRecords.map((proposal) => [proposal.id, proposal]));
    const outside = await workspaceMark(workspace);
    return stored.flatMap((proposal): (FileProposal | ItemProposalRecord)[] => {
      if (proposal.target === "file") return [fileProposalOf(proposal, store.listVersionHeads(proposal.id), outside(proposal.path))];
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
      const side = itemSide();
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
      if (toReject(store, id).target === "item" && items === undefined) throw itemsNotConfigured();
      return summaryOf(committed(id, store.rejectProposal(id, reason)));
    });

  /**
   * Settles every proposal a service death left applying, from what its target holds: written with the intent →
   * approved, else pending. Run before the server takes requests. An item proposal waits while items aren't set up,
   * and one whose items can't be read waits for the next start: settling it pending could make a create twice.
   */
  const settleAtStart = async () => {
    for (const stored of store.listApplying()) {
      const target = stored.target === "file" ? fileTarget : items?.itemTarget;
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
      log("proposal_settled_at_start", { proposalId: stored.id, status: outcome.status });
    }
  };

  const { revise, putDraft, clearDraft } = reviser({ store, decide, committed, items, holds, summaryOf });

  return { proposeFile, proposeItem, revise, putDraft, clearDraft, list, get, approve, reject, settleAtStart };
};

export type Proposals = ReturnType<typeof createProposals>;

type OpenProposalsOptions = Omit<ProposalsOptions, "items" | "holds"> & {
  /** The items root's catalog and writer; without them there are no item tools, and every file is a plain one. */
  items?: { catalog: Catalog; writer: Writer } | undefined;
};

/**
 * The proposals with everything they work with: the item tools' access and the item side of proposals (both
 * undefined without items), the proposals told which files the items own, and the note source for the agents' next messages.
 */
export const openProposals = ({ items, ...options }: OpenProposalsOptions) => {
  const access = items === undefined ? undefined : openAccess(items);
  const itemProposals = items === undefined ? undefined : openItemProposals({ ...items, store: options.store });
  const holds = items === undefined ? undefined : (path: string) => items.catalog.holds(path);
  const proposals = createProposals({ ...options, items: itemProposals, holds });
  const notes = noteSource({ store: options.store, items: itemProposals, log: options.log });
  return { access, proposals, notes };
};
