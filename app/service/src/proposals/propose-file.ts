// An agent's proposed change to a plain file, and its revision of one: the checks each runs before anything is
// stored, and their refusals.
import { isAbsolute } from "node:path";

import { MAX_EDIT_OLD_BYTES, MAX_EDITS, MAX_PROPOSAL_BYTES } from "@wombat/shared/proposals";

import { AgentError } from "../agents/errors.ts";
import { TOOL } from "../items/tools.ts";
import { awaitsNewVersion } from "../store/proposal-rules.ts";
import { textOf, type TextContent } from "../store/proposals.ts";
import type { FileEdit, NewProposal, ProposalContent, ProposalVersionRecord, StoredProposal } from "../store/store.ts";
import { applyEdits, type EditProblem } from "./edits.ts";
import { checkText, isThere, movedSince, readTarget, resolveTarget, textRefusal } from "./file-target.ts";
import type { ProposalResult } from "./item-proposals.ts";
import { ASK_TO_REJECT, PROPOSAL_UNCHANGED, ProposalRefused } from "./refused.ts";

/** A proposed file change as the agent sends it: exactly one of non-empty `edits` (an existing file) or `content` (a new one). */
type FileChange = { edits?: readonly FileEdit[] | undefined; content?: string | undefined };

const NOTHING_PROPOSED = "Nothing was proposed.";

/** The refusals of a change that isn't exactly one of non-empty `edits` or `content`: `both` given, or `neither`. */
type ChangeRefusals = { both: string; neither: string };

const PROPOSE_REFUSALS: ChangeRefusals = {
  both: "Send either edits (to change an existing file) or content (for a new file), not both.",
  neither: "Send edits (a non-empty list of { old, new }) to change an existing file, or content for a new file.",
};

/** Which change was asked for, or the refusal when it isn't exactly one of non-empty `edits` or `content`. */
const changeOf = ({ edits, content }: FileChange, refusals: ChangeRefusals = PROPOSE_REFUSALS): { edits: readonly FileEdit[] } | { content: string } | { refusal: string } => {
  if (edits !== undefined && content !== undefined) return { refusal: refusals.both };
  if (content !== undefined) return { content };
  if (edits === undefined || edits.length === 0) return { refusal: refusals.neither };
  return { edits };
};

/** The refusal for edits to a file that isn't there. */
const missingRefusal = (path: string) => `${path} doesn't exist. To propose a new file, send its content instead of edits.`;

/** The refusal when the change doesn't fit whether the file exists, else undefined. */
const targetRefusal = (change: { edits: readonly FileEdit[] } | { content: string }, exists: boolean, path: string): string | undefined => {
  if ("edits" in change && !exists) return missingRefusal(path);
  if ("content" in change && exists) return `${path} already exists. To propose a change to it, send edits instead of content.`;
  return undefined;
};

const REPLACE_WHOLE = "To replace the whole text, send content instead of edits.";

const OR_CONTENT = "or send content (the whole new text) instead of edits";

/** What edits apply to: the file (a propose), the text a pending proposal holds now, or the file now (a conflict's revise). */
type EditSource = "file" | "proposal" | "fileNow";

/**
 * Per source: how its text is named, what to read again, what to send instead, what to do about an old text over the
 * limit and about too many edits, the refusal's last sentence, and why edits or content that leave its text as it is
 * are refused.
 */
const EDIT_SOURCES = {
  file: {
    text: "the file",
    reread: "Read the file again",
    instead: "For a new file, send content instead of edits.",
    shorter: "Use a shorter old text that still occurs exactly once in the file; to change a long passage, split the change into several edits.",
    fewer: "Combine neighbouring edits into fewer, larger ones.",
    outcome: NOTHING_PROPOSED,
    sameEdits: "Your edits change nothing: the file's text after them is the same as now.",
    sameContent: "The content is the same as the file's text now, so it changes nothing.",
  },
  proposal: {
    text: "your proposal's current text",
    reread: "Check the text your proposal holds now (your last version, or the user's edit of it)",
    instead: REPLACE_WHOLE,
    shorter: `Use a shorter old text that still occurs exactly once in your proposal's current text, ${OR_CONTENT}.`,
    fewer: `Combine neighbouring edits into fewer, larger ones, ${OR_CONTENT}.`,
    outcome: PROPOSAL_UNCHANGED,
    sameEdits: "Your edits change nothing: your proposal's current text after them is the same as before.",
    sameContent: "The content is the same as your proposal's current text, so it changes nothing.",
  },
  fileNow: {
    text: "the file as it is now",
    reread: "Read the file again",
    instead: REPLACE_WHOLE,
    shorter: `Use a shorter old text that still occurs exactly once in the file as it is now, ${OR_CONTENT}.`,
    fewer: `Combine neighbouring edits into fewer, larger ones, ${OR_CONTENT}.`,
    outcome: PROPOSAL_UNCHANGED,
    sameEdits: "Your edits change nothing: the file as it is now after them is the same as before.",
    sameContent: `The content is the same as the file's text now, so there is nothing left to propose: ${ASK_TO_REJECT}.`,
  },
} as const satisfies Record<EditSource, Record<string, string>>;

/** The refusal for `count` edits, more than one call applies. */
const tooManyEdits = (count: number, source: EditSource) =>
  `You sent ${String(count)} edits; one call applies at most ${String(MAX_EDITS)}. ${EDIT_SOURCES[source].fewer} ${EDIT_SOURCES[source].outcome}`;

/** The refusal for an edit that can't apply to `source`'s text. */
const editRefusal = (problem: EditProblem, source: EditSource = "file"): string => {
  const { text, reread, instead, shorter, outcome } = EDIT_SOURCES[source];
  const { edit } = problem;
  if ("tooLong" in problem) return `Edit ${String(edit)}'s old text is larger than ${String(MAX_EDIT_OLD_BYTES / 1024)} KiB, the most one old text may be. ${shorter} ${outcome}`;
  if ("empty" in problem) return `Edit ${String(edit)}'s old text is empty; it must be text that occurs exactly once in ${text}. ${instead} ${outcome}`;
  const { matches } = problem;
  const where = edit === 1 ? text : `${text} as the edits before it leave it`;
  const found = matches === 0 ? "isn't found in" : `is found ${String(matches)} times in`;
  return `Edit ${String(edit)}'s old text ${found} ${where}; it must match exactly once. ${reread} and copy old exactly, with enough surrounding text to be unique. ${outcome}`;
};

/**
 * The one refusal for a file the items catalog holds, whichever binder it's in: it names none. A revise (of the
 * proposal whose file it became) also asks for the proposal's rejection.
 */
const itemsFileRefusal = (path: string, call: "propose" | "revise" = "propose") => {
  const tool = call === "propose" ? TOOL.proposeChange : TOOL.reviseProposal;
  const itemTools = `Use the item tools instead: ${TOOL.getItem} to read an item, then ${TOOL.proposeUpdate}, ${TOOL.proposeCreate} or ${TOOL.proposeDelete}`;
  return call === "propose"
    ? `${path} belongs to the items, so ${tool} can't change it. ${itemTools}. ${NOTHING_PROPOSED}`
    : `${path} belongs to the items now, so ${tool} can't change it. ${PROPOSAL_UNCHANGED} ${itemTools}, and ${ASK_TO_REJECT}.`;
};

const FOLDER_GONE =
  "The folder you work in is gone from the workspace, so a relative path can't be resolved. Give the file's absolute path.";

type FileProposerOptions = {
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
    const proposal = { target: "file", path: target.realPath, binder: null, itemId: null, file: null, reason, agentId } as const;

    if ("content" in asked) {
      const checked = checkText(asked.content);
      if ("problem" in checked) throw textRefusal(checked.problem, "The content");
      return insert({ ...proposal, kind: "create", baseVersion: null }, { text: checked.text });
    }
    const current = await readTarget(target.realPath, path);
    if (current === undefined) throw new ProposalRefused(missingRefusal(path));
    const { content } = fileRevision({ text: current.text, source: "file", chain: [] }, asked);
    return insert({ ...proposal, kind: "edit", baseVersion: current.version }, content);
  };
};

/** A revise's change as the agent sends it: exactly one of non-empty `edits` or `content` for a file, `fields` for an item. */
export type Revision = FileChange & { fields?: Record<string, unknown> | undefined };

const REVISE_REFUSALS: ChangeRefusals = {
  both: `Send either edits or content (the whole new text), not both. ${PROPOSAL_UNCHANGED}`,
  neither: `Send edits (a non-empty list of { old, new }) or content (the whole new text) for the new version. ${PROPOSAL_UNCHANGED}`,
};

/** Which change a file proposal's revise asked for, or the refusal when it isn't exactly one of non-empty `edits` or `content`. */
const fileRevisionOf = (revision: Revision): { edits: readonly FileEdit[] } | { content: string } | { refusal: string } => {
  if (revision.fields !== undefined) {
    return { refusal: `This is a file proposal, so it takes no fields: send edits (a list of { old, new }) or content (the whole new text). ${PROPOSAL_UNCHANGED}` };
  }
  return changeOf(revision, REVISE_REFUSALS);
};

/**
 * What a new version is made on: `text` from `source`; `baseVersion`, the proposal's new base (undefined keeps it);
 * `chain`, the edits from the base to `text` that the new version's edits extend, undefined when there are none.
 */
export type RevisionBase = { text: string; source: EditSource; baseVersion?: string | null; chain?: readonly FileEdit[] | undefined };

/** A file revision's new version: its content and new base (undefined keeps it). */
type FileRevision = { content: TextContent; baseVersion?: string | null };

/**
 * The edits a version stores, leading from the proposal's base to its text; none once they are more than MAX_EDITS
 * (approve applies them in one call) or hold more than MAX_PROPOSAL_BYTES of old and new text, so approving on a
 * changed file then conflicts.
 */
const storedChain = (edits: readonly FileEdit[]): FileEdit[] | undefined => {
  if (edits.length > MAX_EDITS) return undefined;
  const bytes = edits.reduce((sum, { oldText, newText }) => sum + Buffer.byteLength(oldText, "utf8") + Buffer.byteLength(newText, "utf8"), 0);
  return bytes > MAX_PROPOSAL_BYTES ? undefined : edits.map(({ oldText, newText }) => ({ oldText, newText }));
};

const unrevisable = (message: string) => new ProposalRefused(`${message} ${PROPOSAL_UNCHANGED}`);

const AFTER_YOUR_EDITS = "The text after your edits";

/** The new version `asked` makes on `base` (a proposal's first edits, on the file, or a revise); throws ProposalRefused. */
export const fileRevision = (base: RevisionBase, asked: { edits: readonly FileEdit[] } | { content: string }): FileRevision => {
  const based = base.baseVersion === undefined ? {} : { baseVersion: base.baseVersion };
  const { outcome, sameContent, sameEdits } = EDIT_SOURCES[base.source];
  if ("content" in asked) {
    if (asked.content === base.text) throw new ProposalRefused(`${sameContent} ${outcome}`);
    const checked = checkText(asked.content);
    if ("problem" in checked) throw textRefusal(checked.problem, "The content");
    return { content: { text: checked.text }, ...based };
  }
  const applied = applyEdits(base.text, asked.edits);
  if ("over" in applied) {
    throw applied.over === "edits" ? new ProposalRefused(tooManyEdits(asked.edits.length, base.source)) : textRefusal("too_large", AFTER_YOUR_EDITS);
  }
  if ("problem" in applied) throw new ProposalRefused(editRefusal(applied.problem, base.source));
  if (applied.text === base.text) throw new ProposalRefused(`${sameEdits} ${outcome}`);
  const checked = checkText(applied.text);
  if ("problem" in checked) throw textRefusal(checked.problem, AFTER_YOUR_EDITS);
  const edits = base.chain === undefined ? undefined : storedChain([...base.chain, ...asked.edits]);
  return { content: { text: checked.text, ...(edits === undefined ? {} : { edits }) }, ...based };
};

const CREATED_MEANWHILE = `Something exists at this path now, so a proposal to create a file there can't be approved. ${PROPOSAL_UNCHANGED} If it is the file you meant, propose an edit to it with ${TOOL.proposeChange}; either way, ${ASK_TO_REJECT}.`;

const MOVED_SINCE = `The path of this proposal leads somewhere else now than when you proposed it, so it can't be revised. ${PROPOSAL_UNCHANGED} Propose the change again with ${TOOL.proposeChange} on the path you mean, and ${ASK_TO_REJECT}.`;

/**
 * Checks a revise of file proposal `stored` whose current version is `current`, and makes its new version. A pending
 * proposal keeps its base: the edits apply to its current text and extend that version's edits while it is the
 * agent's and has some, so approving on a changed file replays the whole chain. A conflicting edit works on the file
 * as it is now, which becomes the base; a conflicting create works on its own text while no file is there. A path
 * that leads somewhere else now, and a file the items catalog holds now, are refused before it is read. Throws ProposalRefused.
 */
export const reviseFile = async (
  stored: Extract<StoredProposal, { target: "file" }>,
  current: ProposalVersionRecord,
  revision: Revision,
  holds: ((realPath: string) => Promise<boolean>) | undefined,
): Promise<FileRevision> => {
  const asked = fileRevisionOf(revision);
  if ("refusal" in asked) throw new ProposalRefused(asked.refusal);
  const proposed = textOf(current.content);
  const onProposal = () => fileRevision({ text: proposed.text, source: "proposal", chain: current.by === "agent" ? proposed.edits : undefined }, asked);
  if (!awaitsNewVersion(stored.status)) return onProposal();
  // A path that can't be resolved now is refused by the read below, which names why.
  if (await movedSince(stored.path, stored.kind).catch(() => false)) throw new ProposalRefused(MOVED_SINCE);
  if ((await holds?.(stored.path)) === true) throw new ProposalRefused(itemsFileRefusal(stored.path, "revise"));
  if (stored.kind === "create") {
    if (await isThere(stored.path, stored.path)) throw new ProposalRefused(CREATED_MEANWHILE);
    return onProposal();
  }
  const now = await readTarget(stored.path, stored.path);
  if (now === undefined) throw unrevisable(`${stored.path} doesn't exist anymore, so there is nothing to revise the proposal on. To make the file anew, propose it with content.`);
  return fileRevision({ text: now.text, source: "fileNow", baseVersion: now.version, chain: [] }, asked);
};
