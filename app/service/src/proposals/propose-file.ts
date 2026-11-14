// An agent's proposed change to a plain file: the checks it runs before anything is stored, and their refusals.
import { isAbsolute } from "node:path";

import { AgentError } from "../agents/errors.ts";
import { TOOL } from "../items/tools.ts";
import type { FileEdit, NewProposal, ProposalContent } from "../store/store.ts";
import { applyEdits, type EditProblem } from "./edits.ts";
import { checkText, readTarget, resolveTarget, textRefusal } from "./file-target.ts";
import type { ProposalResult } from "./item-proposals.ts";
import { ProposalRefused } from "./refused.ts";

/** A proposed file change as the agent sends it: exactly one of non-empty `edits` (an existing file) or `content` (a new one). */
export type FileChange = { edits?: readonly FileEdit[] | undefined; content?: string | undefined };

const NOTHING_PROPOSED = "Nothing was proposed.";

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

/** The refusal for edits to a file that isn't there. */
const missingRefusal = (path: string) => `${path} doesn't exist. To propose a new file, send its content instead of edits.`;

/** The refusal when the change doesn't fit whether the file exists, else undefined. */
export const targetRefusal = (change: { edits: readonly FileEdit[] } | { content: string }, exists: boolean, path: string): string | undefined => {
  if ("edits" in change && !exists) return missingRefusal(path);
  if ("content" in change && exists) return `${path} already exists. To propose a change to it, send edits instead of content.`;
  return undefined;
};

/** The refusal for an edit that can't apply. */
export const editRefusal = (problem: EditProblem): string => {
  const { edit } = problem;
  if ("empty" in problem) {
    return `Edit ${String(edit)}'s old text is empty; it must be text that occurs exactly once in the file. For a new file, send content instead of edits. ${NOTHING_PROPOSED}`;
  }
  const { matches } = problem;
  const where = edit === 1 ? "the file" : "the file as the edits before it leave it";
  const found = matches === 0 ? "isn't found in" : `is found ${String(matches)} times in`;
  return (
    `Edit ${String(edit)}'s old text ${found} ${where}; it must match exactly once. ` +
    `Read the file again and copy old exactly, with enough surrounding text to be unique. ${NOTHING_PROPOSED}`
  );
};

/** The one refusal for a file the items catalog holds, whichever structure it's in: it names none. */
export const itemsFileRefusal = (path: string) =>
  `${path} belongs to the items, so ${TOOL.proposeChange} can't change it. Use the item tools instead: ${TOOL.getItem} to read an item, ` +
  `then ${TOOL.proposeUpdate}, ${TOOL.proposeCreate} or ${TOOL.proposeDelete}. ${NOTHING_PROPOSED}`;

const UNCHANGED = `Your edits change nothing: the file's text after them is the same as now. ${NOTHING_PROPOSED}`;
const FOLDER_GONE =
  "The folder you work in is gone from the workspace, so a relative path can't be resolved. Give the file's absolute path.";

export type FileProposerOptions = {
  /** The folder an agent runs in: a relative path it proposes starts there. Throws AgentError when it's gone. */
  agentFolder: (agentId: string) => string;
  /** Whether the items catalog holds a file (the item tools change it, never a file proposal); undefined without items. */
  holds?: ((realPath: string) => Promise<boolean>) | undefined;
  /** Stores a checked proposal; throws ProposalRefused at the cap. */
  insert: (proposal: NewProposal, firstVersion: ProposalContent) => ProposalResult;
};

/** `proposeFile(agentId, path, reason, change)`: runs a file change's checks, then stores it; throws ProposalRefused. */
export const fileProposer = ({ agentFolder, holds, insert }: FileProposerOptions) => {
  const folderFor = (agentId: string) => {
    try {
      return agentFolder(agentId);
    } catch (error) {
      if (error instanceof AgentError) throw new ProposalRefused(FOLDER_GONE);
      throw error;
    }
  };

  return async (agentId: string, path: string, reason: string, change: FileChange): Promise<ProposalResult> => {
    const asked = changeOf(change);
    if ("refusal" in asked) throw new ProposalRefused(asked.refusal);
    const target = await resolveTarget(path, isAbsolute(path) ? "" : folderFor(agentId));
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
    if (current === undefined) throw new ProposalRefused(missingRefusal(path));
    const applied = applyEdits(current.text, asked.edits);
    if ("problem" in applied) throw new ProposalRefused(editRefusal(applied.problem));
    if (applied.text === current.text) throw new ProposalRefused(UNCHANGED);
    const checked = checkText(applied.text);
    if ("problem" in checked) throw textRefusal(checked.problem, "The text after your edits");
    const edits = asked.edits.map(({ oldText, newText }) => ({ oldText, newText }));
    return insert({ ...proposal, kind: "edit", baseVersion: current.version }, { text: checked.text, edits });
  };
};
