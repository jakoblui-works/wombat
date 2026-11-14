// The plain file a proposal targets: where its path points, and whether its text is text a proposal may hold.
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, sep } from "node:path";

import { errorCode, isMissing, isMissingPath } from "@wombat/shared/errno";
import { MAX_PROPOSAL_BYTES } from "@wombat/shared/proposals";

import { versionOf } from "../items/files.ts";
import { isWithin } from "../workspace.ts";
import { ProposalRefused } from "./refused.ts";

export type Target = { realPath: string; outsideWorkspace: boolean; exists: boolean };

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

/** The refusal for a checkText problem; `subject` starts the sentence ("The proposed text", a path). */
export const textRefusal = (problem: TextProblem, subject: string) =>
  new ProposalRefused(
    problem === "too_large"
      ? `${subject} is larger than ${String(MAX_PROPOSAL_BYTES / 1024)} KiB, the most a proposal can hold. Propose a smaller change, or tell the user what you'd change.`
      : `${subject} isn't UTF-8 text, so it can't be proposed. Proposals are for text files only.`,
  );

/** Tells whether a real path lies outside the workspace, judged against the workspace's real path. */
export const workspaceMark = async (workspace: string) => {
  const root = await realpath(workspace);
  return (realPath: string) => !isWithin(root, realPath);
};

const unreadable = (path: string, error: unknown) =>
  new ProposalRefused(`${path} can't be read (${errorCode(error)}). Check the path, or tell the user what you'd change there.`);

const notRegular = (path: string) => new ProposalRefused(`${path} isn't a regular file, so it can't be proposed. Proposals are for text files only.`);

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

/**
 * Where `path` (absolute, or relative to the agent's folder) points: an existing regular file's real path, or a new
 * file's (its folder's real path plus its name, the folder existing). Refuses anything else with ProposalRefused.
 */
export const resolveTarget = async (path: string, agentFolder: string, workspace: string): Promise<Target> => {
  // dirname and basename drop a trailing separator, which would turn `file/` into `file`.
  if (path.endsWith(sep)) throw new ProposalRefused(`${path} ends with ${sep}. Give the path of a file, without a trailing ${sep}.`);
  const given = isAbsolute(path) ? path : `${agentFolder}${sep}${path}`;
  const outside = await workspaceMark(workspace);
  const existing = await realOrMissing(given, path);
  if (existing !== undefined) {
    const stats = await statOf(existing, path);
    if (stats.isDirectory()) throw new ProposalRefused(`${path} is a folder. Propose a change to a file in it, or a new file there.`);
    if (!stats.isFile()) throw notRegular(path);
    return { realPath: existing, outsideWorkspace: outside(existing), exists: true };
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
  return { realPath, outsideWorkspace: outside(realPath), exists: false };
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

/** An existing target's text and version; refuses a file gone since, or one that isn't text that fits. */
export const readTarget = async (realPath: string, path: string): Promise<{ text: string; version: string }> => {
  let file: TargetText | undefined;
  try {
    file = await readText(realPath);
  } catch (error) {
    throw unreadable(path, error);
  }
  if (file === undefined) throw new ProposalRefused(`${path} doesn't exist anymore. Check the path; for a new file send content instead of edits.`);
  if ("problem" in file) throw file.problem === "not_file" ? notRegular(path) : textRefusal(file.problem, path);
  return file;
};
