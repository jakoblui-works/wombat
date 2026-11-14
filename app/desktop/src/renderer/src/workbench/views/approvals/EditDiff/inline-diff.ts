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

/** A stored diff's fields, as a `proposal_note` carries them. */
export type StoredDiff = { diff?: readonly DiffLine[] | undefined; diffContinues?: true | undefined; diffTooLarge?: true | undefined };

export const NOTE_TOO_LARGE = "The changes were too large to show.";
export const NOTE_NEWLINE_ONLY = "Only the final newline changed.";
export const NOTE_CONTINUES = "More lines follow that didn't change.";

/**
 * A stored diff as rows (gaps worked out from the lines' numbers) and the fixed lines that go with them: too large,
 * only the final newline differing (an empty diff), and unchanged lines continuing after the last one.
 */
export const storedDiffRows = ({ diff, diffContinues, diffTooLarge }: StoredDiff): { rows: InlineRow[]; says: string[] } => {
  if (diffTooLarge === true) return { rows: [], says: [NOTE_TOO_LARGE] };
  const says: string[] = [];
  const rows: InlineRow[] = [];
  if (diff?.length === 0) says.push(NOTE_NEWLINE_ONLY);
  let old = 0;
  let now = 0;
  for (const line of diff ?? []) {
    // Unchanged lines left out since the last row, counted on the side this line has a number on.
    const skipped = rows.length === 0 ? 0 : "oldLine" in line ? line.oldLine - old - 1 : line.newLine - now - 1;
    if (skipped > 0) rows.push({ kind: "gap", count: skipped });
    rows.push(line);
    if ("oldLine" in line) old = line.oldLine;
    if ("newLine" in line) now = line.newLine;
  }
  if (diffContinues === true) says.push(NOTE_CONTINUES);
  return { rows, says };
};
