// A note's stored diff as the chat shows it: the service stores only the changed lines with a little context, each
// line with its numbers; the rows between hunks are counted from those numbers.
import { expect, test } from "vitest";

import type { DiffLine } from "@wombat/shared/line-diff";

import { NOTE_CONTINUES, NOTE_NEWLINE_ONLY, NOTE_TOO_LARGE, storedDiffRows } from "./inline-diff.ts";

// Hours file: a line added after line 1; later, line 9 ("Sunday: closed") removed. Lines 3 to 8 unchanged between.
const FIRST_HUNK: DiffLine[] = [
  { kind: "context", text: "# Opening hours", oldLine: 1, newLine: 1 },
  { kind: "added", text: "Holidays: closed", newLine: 2 },
  { kind: "context", text: "Monday: 7:00 to 18:00", oldLine: 2, newLine: 3 },
];
const SECOND_HUNK: DiffLine[] = [
  { kind: "removed", text: "Sunday: closed", oldLine: 9 },
  { kind: "context", text: "", oldLine: 10, newLine: 10 },
];

test.each<[string, Parameters<typeof storedDiffRows>[0], ReturnType<typeof storedDiffRows>]>([
  ["two hunks have the unchanged lines between them as one gap", { diff: [...FIRST_HUNK, ...SECOND_HUNK] }, { rows: [...FIRST_HUNK, { kind: "gap", count: 6 }, ...SECOND_HUNK], says: [] }],
  ["unchanged lines after the last one are said to follow", { diff: FIRST_HUNK, diffContinues: true }, { rows: FIRST_HUNK, says: [NOTE_CONTINUES] }],
  ["an empty diff: only the final newline changed", { diff: [] }, { rows: [], says: [NOTE_NEWLINE_ONLY] }],
  ["a diff too large to store", { diffTooLarge: true }, { rows: [], says: [NOTE_TOO_LARGE] }],
])("%s", (_name, stored, want) => {
  expect(storedDiffRows(stored)).toEqual(want);
});
