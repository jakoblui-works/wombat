// S7 T14 (silent failure): what the user approves is what changes. `lineDiff` is a faithful line diff: its context
// and removed lines are the old text's lines in order, numbered from 1; its context and added lines are the new
// text's, numbered from 1; and it marks only what changed (one inserted, deleted or replaced line is one change, not a
// rewrite of the file). Lines split on "\n"; a trailing "\n" ends the last line, so a difference only in the final
// newline changes no line.
import fc from "fast-check";
import { expect, test } from "vitest";

import { type DiffLine, lineDiff } from "./line-diff.ts";

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

const changes = (diff: DiffLine[]) => ({
  removed: diff.filter(({ kind }) => kind === "removed").length,
  added: diff.filter(({ kind }) => kind === "added").length,
});

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

test("the same text is all context, whatever its final newline", () => {
  fc.assert(
    fc.property(lines, (ls) => {
      // Without a final newline, a last empty line can't be written ("a\n" is the line "a"): that pair needs a last
      // line with text.
      const pairs: (readonly [string, string])[] = [[textOf(ls), textOf(ls)]];
      if (ls.at(-1) !== "") pairs.push([textOf(ls), ls.join("\n")]);
      for (const [a, b] of pairs) {
        expect(changes(lineDiff(a, b))).toEqual({ removed: 0, added: 0 });
      }
    }),
  );
});

test("one line inserted, deleted or replaced is exactly that one change", () => {
  fc.assert(
    fc.property(lines, line, fc.nat(), (ls, extra, at) => {
      const i = at % (ls.length + 1);
      const inserted = [...ls.slice(0, i), extra, ...ls.slice(i)];
      expect(changes(lineDiff(textOf(ls), textOf(inserted)))).toEqual({ removed: 0, added: 1 });
      expect(changes(lineDiff(textOf(inserted), textOf(ls)))).toEqual({ removed: 1, added: 0 });

      if (ls.length > 0) {
        const j = at % ls.length;
        const replaced = ls.map((l, k) => (k === j ? "const replaced = true;" : l));
        expect(changes(lineDiff(textOf(ls), textOf(replaced)))).toEqual({ removed: 1, added: 1 });
      }
    }),
  );
});

test("empty texts: nothing, or every line added or removed", () => {
  expect(lineDiff("", "")).toEqual([]);
  expect(changes(lineDiff("", "a\nb\n"))).toEqual({ removed: 0, added: 2 });
  expect(changes(lineDiff("a\nb", ""))).toEqual({ removed: 2, added: 0 });
});
