import type { FileEdit } from "../store/store.ts";

/** Why an edit can't apply: its 1-based position, and how often its old text occurs (or that it is empty). */
export type EditProblem = { edit: number; matches: number } | { edit: number; empty: true };

/**
 * Where `old` occurs in `text`, overlapping occurrences included: any second one makes the edit ambiguous. An empty
 * `old` has no position, so none.
 */
const matchesOf = (text: string, old: string) => {
  const at: number[] = [];
  if (old === "") return at;
  for (let index = text.indexOf(old); index !== -1; index = text.indexOf(old, index + 1)) at.push(index);
  return at;
};

/**
 * Applies the edits in order, each to the text the earlier ones produced. Each `oldText` must be non-empty and occur
 * exactly once; otherwise the first edit that doesn't is the problem.
 */
export const applyEdits = (text: string, edits: readonly FileEdit[]): { text: string } | { problem: EditProblem } => {
  let current = text;
  for (const [index, { oldText, newText }] of edits.entries()) {
    if (oldText === "") return { problem: { edit: index + 1, empty: true } };
    const matches = matchesOf(current, oldText);
    const [at] = matches;
    if (matches.length !== 1 || at === undefined) return { problem: { edit: index + 1, matches: matches.length } };
    current = current.slice(0, at) + newText + current.slice(at + oldText.length);
  }
  return { text: current };
};
