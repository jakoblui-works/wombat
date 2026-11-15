import { MAX_EDIT_OLD_BYTES, MAX_EDITS, MAX_PROPOSAL_BYTES } from "@wombat/shared/proposals";

import type { FileEdit } from "../store/store.ts";

/**
 * Why an edit can't apply: its 1-based position, and how often its old text occurs, or that it is empty or longer
 * than MAX_EDIT_OLD_BYTES.
 */
export type EditProblem = { edit: number; matches: number } | { edit: number; empty: true } | { edit: number; tooLong: true };

/**
 * Where `old` (non-empty) first occurs in `text`, and how often, overlapping occurrences included: any second one
 * makes the edit ambiguous. One pass over each (Knuth-Morris-Pratt): `indexOf` slows down with `old`'s length on
 * repetitive text, so a long `old` could stall the service.
 */
const matchesOf = (text: string, old: string): { first: number; count: number } => {
  const fallback = new Int32Array(old.length);
  for (let index = 1, matched = 0; index < old.length; index += 1) {
    while (matched > 0 && old.charCodeAt(index) !== old.charCodeAt(matched)) matched = fallback[matched - 1] ?? 0;
    if (old.charCodeAt(index) === old.charCodeAt(matched)) matched += 1;
    fallback[index] = matched;
  }
  let first = -1;
  let count = 0;
  for (let index = 0, matched = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    while (matched > 0 && code !== old.charCodeAt(matched)) matched = fallback[matched - 1] ?? 0;
    if (code === old.charCodeAt(matched)) matched += 1;
    if (matched === old.length) {
      if (count === 0) first = index - old.length + 1;
      count += 1;
      matched = fallback[matched - 1] ?? 0;
    }
  }
  return { first, count };
};

/**
 * Applies the edits in order, each to the text the earlier ones produced. Each `oldText` must be non-empty, at most
 * MAX_EDIT_OLD_BYTES, and occur exactly once; otherwise the first edit that doesn't is the problem. `over: "edits"`
 * for more than MAX_EDITS edits, before any is applied; `over: "text"` when a text along the way is larger than
 * MAX_PROPOSAL_BYTES. The final text's exact check stays with the caller.
 */
export const applyEdits = (text: string, edits: readonly FileEdit[]): { text: string } | { problem: EditProblem } | { over: "text" | "edits" } => {
  if (edits.length > MAX_EDITS) return { over: "edits" };
  let current = text;
  let bytes = Buffer.byteLength(text, "utf8");
  for (const [index, { oldText, newText }] of edits.entries()) {
    if (oldText === "") return { problem: { edit: index + 1, empty: true } };
    const oldBytes = Buffer.byteLength(oldText, "utf8");
    if (oldBytes > MAX_EDIT_OLD_BYTES) return { problem: { edit: index + 1, tooLong: true } };
    const { first, count } = matchesOf(current, oldText);
    if (count !== 1) return { problem: { edit: index + 1, matches: count } };
    current = current.slice(0, first) + newText + current.slice(first + oldText.length);
    bytes += Buffer.byteLength(newText, "utf8") - oldBytes;
    if (bytes > MAX_PROPOSAL_BYTES) return { over: "text" };
  }
  return { text: current };
};
