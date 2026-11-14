// What agents propose and the user later decides, for every target. Every propose call ends in `insert`, which owns
// the cap: a call over it is refused before anything is stored. Nothing here writes a target.
import { isAbsolute } from "node:path";

import { MAX_OPEN_PROPOSALS, type FileProposal, type ProposalStatus } from "@wombat/shared/proposals";

import { AgentError } from "../agents/errors.ts";
import type { Log } from "../log.ts";
import type { FileEdit, NewProposal, ProposalContent, ProposalVersionHead, Store, StoredProposal } from "../store/store.ts";
import { announcer } from "./announce.ts";
import { applyEdits, type EditProblem } from "./edits.ts";
import { checkText, readTarget, resolveTarget, textRefusal, workspaceMark } from "./file-target.ts";
import type { ItemProposalRecord, ProposalResult } from "./item-proposals.ts";
import { commonFields } from "./proposal-fields.ts";
import { ProposalRefused } from "./refused.ts";

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
  /** The item proposals as the list sends them, while items are set up. */
  itemProposals?: ((status?: ProposalStatus) => Promise<ItemProposalRecord[]>) | undefined;
};

export const createProposals = ({ store, workspace, agentFolder, onProposal, log, itemProposals }: ProposalsOptions) => {
  const announce = announcer(onProposal, log);

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
    const items = new Map((itemProposals === undefined ? [] : await itemProposals(status)).map((proposal) => [proposal.id, proposal]));
    const outside = await workspaceMark(workspace);
    return store.listProposals(status).flatMap((stored): (FileProposal | ItemProposalRecord)[] => {
      if (stored.target === "file") return [fileProposalOf(stored, store.listVersionHeads(stored.id), outside(stored.path))];
      const item = items.get(stored.id);
      return item === undefined ? [] : [item];
    });
  };

  return { proposeFile, list };
};

export type Proposals = ReturnType<typeof createProposals>;
