// What the user approves is what changes. `lineDiff` is a faithful line diff: its context
// and removed lines are the old text's lines in order, numbered from 1; its context and added lines are the new
// text's, numbered from 1; and it marks only what changed (one inserted, deleted or replaced line is one change, not a
// rewrite of the file). Lines split on "\n"; a trailing "\n" ends the last line, so a difference only in the final
// newline changes no line.
import fc from "fast-check";
import { expect, test } from "vitest";

import { lineDiff } from "./line-diff.ts";

/** The text's lines by the stated rule. */
const linesOf = (text: string): string[] => {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

/** Each line ended by "\n": the lines are exactly `lines`. */
const textOf = (lines: readonly string[]): string => lines.map((line) => `${line}\n`).join("");

// A small alphabet, so repeated lines (the hard case for a diff) are common.
const line = fc.constantFrom("const a = 1;", "const b = 2;", "", "}", "return a;", "// note");
const lines = fc.array(line, { maxLength: 12 });
const text = fc.tuple(lines, fc.boolean()).map(([ls, endsWithNewline]) => (endsWithNewline ? textOf(ls) : ls.join("\n")));

test("the diff rebuilds both texts, in order, with line numbers counting from 1", () => {
  fc.assert(
    fc.property(text, text, (oldText, newText) => {
      const diff = lineDiff(oldText, newText);
      const oldSide = diff.filter((l) => l.kind !== "added");
      const newSide = diff.filter((l) => l.kind !== "removed");
      expect(oldSide.map((l) => l.text)).toEqual(linesOf(oldText));
      expect(oldSide.map((l) => l.oldLine)).toEqual(linesOf(oldText).map((_, i) => i + 1));
      expect(newSide.map((l) => l.text)).toEqual(linesOf(newText));
      expect(newSide.map((l) => l.newLine)).toEqual(linesOf(newText).map((_, i) => i + 1));
    }),
  );
});
