// The plain file a proposal targets: where its path points, whether its text is text a proposal may hold, and
// writing an approved proposal onto it.
import { constants } from "node:fs";
import { access, lstat, open, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, sep } from "node:path";

import { errorCode, isAlreadyThere, isMissing, isMissingPath } from "@wombat/shared/errno";
import { MAX_PROPOSAL_BYTES, type FileProposalKind } from "@wombat/shared/proposals";

import { NoHardLinks, VersionChanged, versionOf, writeAtomic } from "../items/files.ts";
import type { TextContent } from "../store/proposals.ts";
import type { FileEdit } from "../store/store.ts";
import { isWithin } from "../workspace.ts";
import { applyEdits, type EditProblem } from "./edits.ts";
import { askAgain, BY_HAND, conflict, NOTHING_WRITTEN, type Applied } from "./apply.ts";
import { ProposalRefused } from "./refused.ts";

export type Target = { realPath: string; exists: boolean };

export type TextProblem = "too_large" | "not_utf8";

/** Whether the bytes (or a string, as UTF-8) are text a proposal may hold: valid UTF-8, at most MAX_PROPOSAL_BYTES. */
export const checkText = (data: Uint8Array | string): { text: string } | { problem: TextProblem } => {
  if (typeof data === "string") {
    if (Buffer.byteLength(data, "utf8") > MAX_PROPOSAL_BYTES) return { problem: "too_large" };
    // A lone surrogate has no UTF-8 form.
    return data.isWellFormed() ? { text: data } : { problem: "not_utf8" };
  }
  if (data.byteLength > MAX_PROPOSAL_BYTES) return { problem: "too_large" };
  try {
    // ignoreBOM keeps a byte order mark in the text, so the text writes back to the same bytes.
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data) };
  } catch {
    return { problem: "not_utf8" };
  }
};

const TEXT_ONLY = "so it can't be proposed. Proposals are for text files only.";

/** What's wrong with `subject`'s text ("The proposed text", a path), as the start of a sentence. */
export const textProblemClause = (problem: TextProblem, subject: string) =>
  problem === "too_large" ? `${subject} is larger than ${String(MAX_PROPOSAL_BYTES / 1024)} KiB, the most a proposal can hold` : `${subject} isn't UTF-8 text`;

/** The refusal for a checkText problem; `subject` starts the sentence ("The proposed text", a path). */
export const textRefusal = (problem: TextProblem, subject: string) =>
  new ProposalRefused(
    `${textProblemClause(problem, subject)}${problem === "too_large" ? ". Propose a smaller change, or tell the user what you'd change." : `, ${TEXT_ONLY}`}`,
  );

/** Tells whether a real path lies outside the workspace, judged against the workspace's real path. */
export const workspaceMark = async (workspace: string) => {
  const root = await realpath(workspace);
  return (realPath: string) => !isWithin(root, realPath);
};

const unreadable = (path: string, error: unknown) =>
  new ProposalRefused(`${path} can't be read (${errorCode(error)}). Check the path, or tell the user what you'd change there.`);

const notRegular = (path: string) => new ProposalRefused(`${path} isn't a regular file, ${TEXT_ONLY}`);

/** The real path, or undefined when nothing is there. */
const realOrMissing = async (given: string, path: string) => {
  try {
    return await realpath(given);
  } catch (error) {
    if (isMissingPath(error)) return undefined;
    throw unreadable(path, error);
  }
};

const statOf = async (realPath: string, path: string) => {
  try {
    return await stat(realPath);
  } catch (error) {
    throw unreadable(path, error);
  }
};

/** What lstat finds at the path, without following a link; undefined when nothing is there. */
const entryAt = async (path: string, shown: string) => {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissingPath(error)) return undefined;
    throw unreadable(shown, error);
  }
};

/** Whether anything is at the path (a link counts, wherever it leads); refuses one that can't be told. */
export const isThere = async (path: string, shown: string) => (await entryAt(path, shown)) !== undefined;

/**
 * Where `path` (absolute, or relative to the agent's folder) points: an existing regular file's real path, or a new
 * file's (its folder's real path plus its name, the folder existing). Refuses anything else with ProposalRefused.
 */
export const resolveTarget = async (path: string, agentFolder: string): Promise<Target> => {
  // dirname and basename drop a trailing separator, which would turn `file/` into `file`.
  if (path.endsWith(sep)) throw new ProposalRefused(`${path} ends with ${sep}. Give the path of a file, without a trailing ${sep}.`);
  const given = isAbsolute(path) ? path : `${agentFolder}${sep}${path}`;
  const existing = await realOrMissing(given, path);
  if (existing !== undefined) {
    const stats = await statOf(existing, path);
    if (stats.isDirectory()) throw new ProposalRefused(`${path} is a folder. Propose a change to a file in it, or a new file there.`);
    if (!stats.isFile()) throw notRegular(path);
    return { realPath: existing, exists: true };
  }
  // A link to nothing: a create would land on the link, not where it points.
  if ((await entryAt(given, path))?.isSymbolicLink() === true) {
    throw new ProposalRefused(`${path} is a symlink to a file that doesn't exist. Give the path the file should have instead.`);
  }
  const parent = await realOrMissing(dirname(given), path);
  if (parent === undefined) {
    throw new ProposalRefused(`The folder ${dirname(path)} doesn't exist. A proposal can add a file, not a folder: give a path in an existing folder.`);
  }
  if (!(await statOf(parent, path)).isDirectory()) {
    throw new ProposalRefused(`${dirname(path)} isn't a folder, so ${path} can't be created. Give a path in an existing folder.`);
  }
  const realPath = join(parent, basename(given));
  if ((await entryAt(realPath, path)) !== undefined) {
    throw new ProposalRefused(`${path} leads to something that already exists but can't be resolved. Give the real path of the file instead.`);
  }
  return { realPath, exists: false };
};

export type TargetText = { text: string; version: string } | { problem: TextProblem | "not_file" };

/**
 * A file's text and version (versionOf exactly the bytes read), reading at most one byte past the limit from one
 * handle, so a file that grew or was swapped since it was resolved is bounded too; undefined when it doesn't exist.
 * Other read errors throw.
 */
export const readText = async (realPath: string): Promise<TargetText | undefined> => {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    // O_NONBLOCK: opening a FIFO with no writer would otherwise wait for one.
    handle = await open(realPath, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) return { problem: "not_file" };
    const buffer = Buffer.alloc(MAX_PROPOSAL_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const bytes = buffer.subarray(0, length);
    const checked = checkText(bytes);
    return "problem" in checked ? checked : { text: checked.text, version: versionOf(bytes) };
  } finally {
    await handle.close();
  }
};

/** An existing target's text and version, undefined when it's gone since; refuses one that isn't text that fits. */
export const readTarget = async (realPath: string, path: string): Promise<{ text: string; version: string } | undefined> => {
  let file: TargetText | undefined;
  try {
    file = await readText(realPath);
  } catch (error) {
    throw unreadable(path, error);
  }
  if (file === undefined) return undefined;
  if ("problem" in file) throw file.problem === "not_file" ? notRegular(path) : textRefusal(file.problem, path);
  return file;
};

/** Whether the file at `realPath` is now exactly `intent`'s version: an approve's write landed. Missing reads as not; throws when it can't be read. */
export const written = async (realPath: string, intent: unknown): Promise<boolean> => {
  let file: TargetText | undefined;
  try {
    file = await readText(realPath);
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
  return file !== undefined && !("problem" in file) && file.version === intent;
};

/** A file proposal's text as it is now; null when it's missing or can't be read as text. */
export const currentText = async (realPath: string): Promise<string | null> => {
  try {
    const file = await readText(realPath);
    return file === undefined || "problem" in file ? null : file.text;
  } catch {
    return null;
  }
};

const ASK_AGAIN = askAgain("file");

const CATALOG_FILE = conflict(`The file is an item's file or a structure's settings, which only the item tools change, ${NOTHING_WRITTEN}. ${BY_HAND}`);
const EXISTS = conflict(`A file was made at this path since the agent proposed creating it, ${NOTHING_WRITTEN}. ${ASK_AGAIN}`);
const GONE = conflict(`The file was deleted or moved since the agent read it, ${NOTHING_WRITTEN}. ${ASK_AGAIN}`);
const NO_EDITS = conflict(`The file changed since this version was made, and the version has no edits to apply to it again, ${NOTHING_WRITTEN}. ${ASK_AGAIN}`);

const textConflict = (problem: TextProblem | "not_file", what: string) =>
  conflict(`${problem === "not_file" ? "The path no longer leads to a regular file" : textProblemClause(problem, what)}, ${NOTHING_WRITTEN}. ${ASK_AGAIN}`);

const editConflict = (problem: EditProblem) => {
  const { edit } = problem;
  const found = "empty" in problem ? "has an empty old text" : problem.matches === 0 ? "no longer finds its old text" : `finds its old text ${String(problem.matches)} times`;
  return conflict(`The file changed since the agent read it, and edit ${String(edit)} of the proposal ${found} in it, ${NOTHING_WRITTEN}. ${ASK_AGAIN}`);
};

/** The proposal's stored edits on the file as it is now: a new version based on it, or the conflict. */
const revised = (now: TargetText | undefined, edits: readonly FileEdit[] | undefined): Applied => {
  if (now === undefined) return GONE;
  if ("problem" in now) return textConflict(now.problem, "The file");
  if (edits === undefined) return NO_EDITS;
  const applied = applyEdits(now.text, edits);
  if ("problem" in applied) return editConflict(applied.problem);
  const checked = checkText(applied.text);
  if ("problem" in checked) return textConflict(checked.problem, "The text after the proposal's edits");
  return { revised: { content: { text: checked.text, edits: [...edits] }, baseVersion: now.version } };
};

export type FileWrite = {
  proposal: { path: string; kind: FileProposalKind; baseVersion: string | null };
  content: TextContent;
  /** Whether the items catalog holds the path; undefined without items. */
  holds?: ((realPath: string) => Promise<boolean>) | undefined;
};

/** A target state the user can fix: the proposal stays pending, to approve again as it is. */
const retry = (message: string): Applied => ({ retry: { message } });

const FOLDER_GONE = retry(`The folder of this file doesn't exist anymore, ${NOTHING_WRITTEN}. Create the folder and approve again, or reject the proposal.`);
const UNREADABLE = retry(
  `The service isn't allowed to read the file or its folder, ${NOTHING_WRITTEN}. Make them readable for the service and approve again, or reject the proposal.`,
);
const READ_ONLY = retry(
  `The file is read-only for the service (its permissions, or a read-only filesystem), ${NOTHING_WRITTEN}. Make it writable and approve again, or reject the proposal.`,
);
const UNWRITABLE = retry(
  `The service isn't allowed to write in the file's folder (its permissions, or a read-only filesystem), ${NOTHING_WRITTEN}. Make the folder writable and approve again, or reject the proposal.`,
);
const NO_HARD_LINKS = conflict(
  `The filesystem of the file's folder can't create a file without risking to replace one made meanwhile (it has no hard links), ${NOTHING_WRITTEN}. Create the file by hand, or reject the proposal.`,
);

const NO_ACCESS = new Set(["EACCES", "EPERM", "EROFS"]);

/** Where touching the target failed: reading it, checking the file may be written, or writing it. */
type Step = "read" | "check" | "write";

/**
 * What an expected failure at `step` (the target's state, not the service's) settles to: a retry once the user fixed
 * the target, or a conflict; undefined for an unexpected failure.
 */
export const failureOutcome = (error: unknown, kind: FileProposalKind, step: Step): Applied | undefined => {
  if (error instanceof NoHardLinks) return NO_HARD_LINKS;
  if (kind === "create" && isAlreadyThere(error)) return EXISTS;
  if (isMissingPath(error)) return kind === "create" ? FOLDER_GONE : GONE;
  if (!NO_ACCESS.has(errorCode(error))) return undefined;
  return step === "read" ? UNREADABLE : step === "check" ? READ_ONLY : UNWRITABLE;
};

/** Carries an expected failure's conflict out of the write; nothing was written. */
class Unworkable extends Error {
  readonly applied: Applied;

  constructor(applied: Applied) {
    super("The target can't be written as it is.");
    this.applied = applied;
    this.name = "Unworkable";
  }
}

const at = async <T>(kind: FileProposalKind, step: Step, run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    const applied = failureOutcome(error, kind, step);
    if (applied === undefined) throw error;
    throw new Unworkable(applied);
  }
};

const write = async ({ proposal, content, holds }: FileWrite): Promise<Applied> => {
  const { path, kind, baseVersion } = proposal;
  if ((await holds?.(path)) === true) return CATALOG_FILE;
  const checked = checkText(content.text);
  if ("problem" in checked) return textConflict(checked.problem, "The proposed text");
  if (kind === "create") {
    if ((await at(kind, "read", () => readText(path))) !== undefined) return EXISTS;
    // Linked into place: fails with EEXIST rather than replace a file made meanwhile.
    await at(kind, "write", () => writeAtomic(path, checked.text, { create: true }));
    return { written: true };
  }
  let now = await at(kind, "read", () => readText(path));
  if (now !== undefined && !("problem" in now) && now.version === baseVersion) {
    // The rename below would replace a file the service may not write, as long as its folder is writable.
    await at(kind, "check", () => access(path, constants.W_OK));
    const landed = await at(kind, "write", async () => {
      try {
        await writeAtomic(path, checked.text, { expectedVersion: baseVersion });
        return true;
      } catch (error) {
        if (error instanceof VersionChanged) return false;
        throw error;
      }
    });
    if (landed) return { written: true };
    now = await at(kind, "read", () => readText(path));
  }
  return revised(now, content.edits);
};

/**
 * Writes the proposed text, only onto the file at the proposal's base version (a create: only where no file is,
 * never replacing one), and only onto a file the service may write. A file changed since gets the stored edits
 * again as a new version instead, or a conflict; so does a file the items catalog holds, and a target the service
 * can't read or write. Unexpected failures throw, with nothing written.
 */
export const writeProposed = async (change: FileWrite): Promise<Applied> => {
  try {
    return await write(change);
  } catch (error) {
    if (error instanceof Unworkable) return error.applied;
    throw error;
  }
};
