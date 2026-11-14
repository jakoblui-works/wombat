// What the chat shows of an edit, pure: each of its diffs' changed lines with a little context around them, or, past a
// size, nothing (the diff tab shows it then).
import { type DiffLine, lineDiffWithin, withContext } from "@wombat/shared/line-diff";

import type { EditDiff } from "../edit-request.ts";

/** Unchanged lines shown before and after each run of changed lines. */
export const CONTEXT_LINES = 3;
/** The most lines (changed and context, all diffs together) the chat shows of one edit; a larger one is only shown side by side. */
export const MAX_DIFF_LINES = 80;

/** A shown line, or a run of unchanged lines left out between two shown ones. */
export type InlineRow = DiffLine | { kind: "gap"; count: number };

/** `parts`: one list of rows per diff, in order. */
export type InlineDiff = { kind: "shown"; parts: InlineRow[][]; added: number; removed: number } | { kind: "too-large" };

/** One diff's rows, or undefined past `budget` shown lines. */
const rowsOf = ({ oldText, newText }: EditDiff, budget: number): { rows: InlineRow[]; shown: number; added: number; removed: number } | undefined => {
  // Shown lines are at least the changed ones, so a diff with more changes than the budget is too large before it's done.
  const lines = lineDiffWithin(oldText ?? "", newText, budget);
  if (lines === undefined) return undefined;
  const shown = withContext(lines, CONTEXT_LINES);
  if (shown.length > budget) return undefined;
  const rows: InlineRow[] = [];
  let last: number | undefined;
  for (const index of shown) {
    const line = lines[index];
    if (line === undefined) continue;
    if (last !== undefined && index > last + 1) rows.push({ kind: "gap", count: index - last - 1 });
    rows.push(line);
    last = index;
  }
  return {
    rows,
    shown: shown.length,
    added: lines.filter(({ kind }) => kind === "added").length,
    removed: lines.filter(({ kind }) => kind === "removed").length,
  };
};

export const inlineDiff = (diffs: readonly EditDiff[]): InlineDiff => {
  const parts: InlineRow[][] = [];
  let budget = MAX_DIFF_LINES;
  let added = 0;
  let removed = 0;
  for (const diff of diffs) {
    const part = rowsOf(diff, budget);
    if (part === undefined) return { kind: "too-large" };
    parts.push(part.rows);
    budget -= part.shown;
    added += part.added;
    removed += part.removed;
  }
  return { kind: "shown", parts, added, removed };
};
