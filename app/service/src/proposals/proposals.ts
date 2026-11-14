// What agents propose and the user decides, for every target. Every propose call ends in `insert`, which owns the
// cap: a call over it is refused before anything is stored. Every approve runs `applying`'s order: the applying
// row with its intent is committed before the target is written, so a service that dies in between settles it at
// the next start from what the target holds.
import { isAbsolute } from "node:path";

import { MAX_OPEN_PROPOSALS, type FileProposal, type ProposalDetail, type ProposalStatus } from "@wombat/shared/proposals";

import { AgentError } from "../agents/errors.ts";
import { versionOf } from "../items/files.ts";
import { TOOL } from "../items/tools.ts";
import type { Log } from "../log.ts";
import type { FileEdit, NewProposal, ProposalChange, ProposalContent, ProposalVersionHead, Store, StoredProposal } from "../store/store.ts";
import { announcer } from "./announce.ts";
import type { Applied, ApplyTarget, ApproveStep } from "./apply.ts";
import { applyEdits, type EditProblem } from "./edits.ts";
import { checkText, currentText, readTarget, resolveTarget, textRefusal, workspaceMark, writeProposed, written } from "./file-target.ts";
import type { ItemProposalDetail, ItemProposalRecord, ItemProposals, ProposalResult } from "./item-proposals.ts";
import { commonFields } from "./proposal-fields.ts";
import { itemsNotConfigured, notApprovable, notFound, ProposalError, ProposalRefused, toApprove, toReject } from "./refused.ts";

/** A proposed file change as the agent sends it: exactly one of non-empty `edits` (an existing file) or `content` (a new one). */
export type FileChange = { edits?: readonly FileEdit[] | undefined; content?: string | undefined };

type StoredFileProposal = Extract<StoredProposal, { target: "file" }>;

/** The cap's refusal for an agent with `open` proposals counting toward it, or undefined while there is room. */
export const capRefusal = (open: number): string | undefined =>
  open < MAX_OPEN_PROPOSALS
    ? undefined
    : `You have ${String(open)} proposals waiting for the user's decision, and one agent may have at most ${String(MAX_OPEN_PROPOSALS)}. ` +
      "Wait until the user approves or rejects some of them before you propose more; keep working meanwhile.";

/** Which change was asked for, or the refusal when it isn't exactly one of non-empty `edits` or `content`. */
export const changeOf = ({ edits, content }: FileChange): { edits: readonly FileEdit[] } | { content: string } | { refusal: string } => {
  if (edits !== undefined && content !== undefined) {
    return { refusal: "Send either edits (to change an existing file) or content (for a new file), not both." };
  }
  if (content !== undefined) return { content };
  if (edits === undefined || edits.length === 0) {
    return { refusal: "Send edits (a non-empty list of { old, new }) to change an existing file, or content for a new file." };
  }
  return { edits };
};

/** The refusal when the change doesn't fit whether the file exists, else undefined. */
export const targetRefusal = (change: { edits: readonly FileEdit[] } | { content: string }, exists: boolean, path: string): string | undefined => {
  if ("edits" in change && !exists) return `${path} doesn't exist. To propose a new file, send its content instead of edits.`;
  if ("content" in change && exists) return `${path} already exists. To propose a change to it, send edits instead of content.`;
  return undefined;
};

/** The refusal for an edit that can't apply. */
export const editRefusal = (problem: EditProblem): string => {
  const { edit } = problem;
  if ("empty" in problem) {
    return `Edit ${String(edit)}'s old text is empty; it must be text that occurs exactly once in the file. For a new file, send content instead of edits. Nothing was proposed.`;
  }
  const { matches } = problem;
  const where = edit === 1 ? "the file" : "the file as the edits before it leave it";
  const found = matches === 0 ? "isn't found in" : `is found ${String(matches)} times in`;
  return (
    `Edit ${String(edit)}'s old text ${found} ${where}; it must match exactly once. ` +
    "Read the file again and copy old exactly, with enough surrounding text to be unique. Nothing was proposed."
  );
};

/** A stored file proposal as the API sends it. */
export const fileProposalOf = (stored: StoredFileProposal, heads: readonly ProposalVersionHead[], outsideWorkspace: boolean): FileProposal => ({
  ...commonFields(stored, heads),
  target: "file",
  path: stored.path,
  outsideWorkspace,
  kind: stored.kind,
});

/** The one refusal for a file the items catalog holds, whichever structure it's in: it names none. */
export const itemsFileRefusal = (path: string) =>
  `${path} belongs to the items, so ${TOOL.proposeChange} can't change it. Use the item tools instead: ${TOOL.getItem} to read an item, ` +
  `then ${TOOL.proposeUpdate}, ${TOOL.proposeCreate} or ${TOOL.proposeDelete}. Nothing was proposed.`;

const UNCHANGED = "Your edits change nothing: the file's text after them is the same as now. Nothing was proposed.";
const FOLDER_GONE =
  "The folder you work in is gone from the workspace, so a relative path can't be resolved. Give the file's absolute path.";

export type ProposalsOptions = {
  store: Store;
  /** The workspace root; a file outside its real path is marked. */
  workspace: string;
  /** The folder an agent runs in: a relative path it proposes starts there. Throws AgentError when it's gone. */
  agentFolder: (agentId: string) => string;
  /** Called once per committed proposal change, with the seq it took. */
  onProposal: (id: string, seq: number) => void;
  log: Log;
  /** The item proposals' own reads and decisions, while items are set up. */
  itemProposals?: Pick<ItemProposals, "proposals" | "detail" | "approve" | "reject"> | undefined;
  /** Whether the items catalog holds a file (the item tools change it, never a file proposal); undefined without items. */
  holds?: ((realPath: string) => Promise<boolean>) | undefined;
  /** Called synchronously at each named step of an approve. */
  onApproveStep?: ((step: ApproveStep) => void) | undefined;
};

export const createProposals = ({ store, workspace, agentFolder, onProposal, log, itemProposals, holds, onApproveStep }: ProposalsOptions) => {
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
    const content = store.listVersions(id).find((version) => version.n === n);
    if (content === undefined) throw new Error(`Proposal ${id} has no version ${String(n)} stored; it can't be read.`);
    return content;
  };

  /** The order of every approve, in the decide queue: the current version, the applying commit, the write, the settle. */
  const applying = async (id: string, version: number, target: ApplyTarget): Promise<StoredProposal> => {
    const stored = toApprove(store, id, version);
    const { content, reason } = contentOf(id, version);
    const begun = store.beginApplying(id, version, target.intentOf(content));
    if (begun === undefined) throw notApprovable(stored);
    announce(id, begun.seq);
    onApproveStep?.("after_applying_commit");
    let applied: Applied;
    try {
      applied = await target.write(begun.proposal, content);
    } catch (error) {
      committed(id, store.settle(id, { status: "pending" }));
      throw error;
    }
    if ("written" in applied) {
      onApproveStep?.("after_write");
      return committed(id, store.settle(id, { status: "approved" }));
    }
    if ("problem" in applied) return committed(id, store.settle(id, { status: "conflict", problem: applied.problem }));
    if ("retry" in applied) return committed(id, store.settle(id, { status: "pending", problem: applied.retry }));
    const { content: next, baseVersion } = applied.revised;
    return committed(id, store.settleRevised(id, next, reason, baseVersion));
  };

  const fileTarget: ApplyTarget = {
    intentOf: (content) => {
      if (!("text" in content)) throw new Error("A file proposal's version holds no text; it can't be approved.");
      return versionOf(Buffer.from(content.text, "utf8"));
    },
    write: async (stored, content) => {
      if (stored.target !== "file" || !("text" in content)) throw new Error(`Proposal ${stored.id} isn't a file proposal; it can't be written as one.`);
      return writeProposed({ proposal: stored, content, holds });
    },
    written: async (stored) => stored.target === "file" && (await written(stored.path, stored.intent)),
  };

  const fileSummary = async (stored: StoredFileProposal) => fileProposalOf(stored, store.listVersionHeads(stored.id), (await workspaceMark(workspace))(stored.path));

  /** Stores a proposal, unless its agent is at the cap, and announces it. Synchronous, so no other call stores between the count and the insert. */
  const insert = (proposal: NewProposal, firstVersion: ProposalContent): ProposalResult => {
    const refusal = capRefusal(store.countOpen(proposal.agentId));
    if (refusal !== undefined) throw new ProposalRefused(refusal);
    const { proposal: stored, seq } = store.insertProposal(proposal, firstVersion);
    announce(stored.id, seq);
    return { proposed: stored.id };
  };

  const folderFor = (agentId: string) => {
    try {
      return agentFolder(agentId);
    } catch (error) {
      if (error instanceof AgentError) throw new ProposalRefused(FOLDER_GONE);
      throw error;
    }
  };

  const proposeFile = async (agentId: string, path: string, reason: string, change: FileChange): Promise<ProposalResult> => {
    const asked = changeOf(change);
    if ("refusal" in asked) throw new ProposalRefused(asked.refusal);
    const target = await resolveTarget(path, isAbsolute(path) ? "" : folderFor(agentId), workspace);
    if ((await holds?.(target.realPath)) === true) throw new ProposalRefused(itemsFileRefusal(path));
    const mismatch = targetRefusal(asked, target.exists, path);
    if (mismatch !== undefined) throw new ProposalRefused(mismatch);
    const proposal = { target: "file", path: target.realPath, structure: null, itemId: null, file: null, reason, agentId } as const;

    if ("content" in asked) {
      const checked = checkText(asked.content);
      if ("problem" in checked) throw textRefusal(checked.problem, "The content");
      return insert({ ...proposal, kind: "create", baseVersion: null }, { text: checked.text });
    }
    const current = await readTarget(target.realPath, path);
    const applied = applyEdits(current.text, asked.edits);
    if ("problem" in applied) throw new ProposalRefused(editRefusal(applied.problem));
    if (applied.text === current.text) throw new ProposalRefused(UNCHANGED);
    const checked = checkText(applied.text);
    if ("problem" in checked) throw textRefusal(checked.problem, "The text after your edits");
    const edits = asked.edits.map(({ oldText, newText }) => ({ oldText, newText }));
    return insert({ ...proposal, kind: "edit", baseVersion: current.version }, { text: checked.text, edits });
  };

  /** Every proposal, or those with `status`, oldest first, as the API lists them. */
  const list = async (status?: ProposalStatus): Promise<(FileProposal | ItemProposalRecord)[]> => {
    const items = new Map((itemProposals === undefined ? [] : await itemProposals.proposals(status)).map((proposal) => [proposal.id, proposal]));
    const outside = await workspaceMark(workspace);
    return store.listProposals(status).flatMap((stored): (FileProposal | ItemProposalRecord)[] => {
      if (stored.target === "file") return [fileProposalOf(stored, store.listVersionHeads(stored.id), outside(stored.path))];
      const item = items.get(stored.id);
      return item === undefined ? [] : [item];
    });
  };

  /** A proposal with its target as it is now and version `version`'s content (default: the current version). */
  const get = async (id: string, version?: number): Promise<ProposalDetail | ItemProposalDetail> => {
    const stored = store.getProposal(id);
    if (stored === undefined) throw notFound(id);
    const heads = store.listVersionHeads(id);
    const n = version ?? heads.at(-1)?.n ?? 1;
    if (!heads.some((head) => head.n === n)) {
      throw new ProposalError(
        "proposal_not_found",
        `Proposal ${id} has no version ${String(n)}; its versions are ${heads.map((head) => String(head.n)).join(", ")}. Ask for one of those.`,
      );
    }
    if (stored.target === "item") {
      if (itemProposals === undefined) throw itemsNotConfigured();
      return itemProposals.detail(id, n);
    }
    const { content } = contentOf(id, n);
    if (!("text" in content)) throw new Error(`Proposal ${id}'s version ${String(n)} holds no text; it can't be read.`);
    return { ...(await fileSummary(stored)), current: await currentText(stored.path), text: content.text, versions: heads };
  };

  /** Approves version `version`, which must be current; a conflict or a new version to approve answers too. */
  const approve = (id: string, version: number): Promise<FileProposal | ItemProposalRecord> =>
    decide(async () => {
      if (store.getProposal(id)?.target === "item") {
        if (itemProposals === undefined) throw itemsNotConfigured();
        return itemProposals.approve(id, version);
      }
      const stored = await applying(id, version, fileTarget);
      if (stored.target !== "file") throw new Error(`Proposal ${id} changed its target while it was being approved.`);
      return fileSummary(stored);
    });

  /** Rejects a pending proposal or a conflict; nothing is written. */
  const reject = (id: string, reason?: string): Promise<FileProposal | ItemProposalRecord> =>
    decide(async () => {
      const stored = toReject(store, id);
      if (stored.target === "item") {
        if (itemProposals === undefined) throw itemsNotConfigured();
        return itemProposals.reject(id, reason);
      }
      const rejected = committed(id, store.rejectProposal(id, reason));
      if (rejected.target !== "file") throw new Error(`Proposal ${id} changed its target while it was being rejected.`);
      return fileSummary(rejected);
    });

  /**
   * Settles every file proposal a service death left applying, from what its file holds: written with the intent →
   * approved, else pending. Run before the server takes requests.
   */
  const settleAtStart = async () => {
    for (const stored of store.listApplying()) {
      if (stored.target !== "file") continue;
      const status = (await fileTarget.written(stored)) ? "approved" : "pending";
      const change = store.settle(stored.id, { status });
      if (change === undefined) continue;
      announce(stored.id, change.seq);
      log("proposal_settled_at_start", { proposalId: stored.id, status });
    }
  };

  return { proposeFile, list, get, approve, reject, settleAtStart };
};

export type Proposals = ReturnType<typeof createProposals>;
