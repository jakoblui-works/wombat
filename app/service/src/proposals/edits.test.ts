// An approve writes exactly the text the edits describe: each edit on what the earlier ones left, the new text as
// typed, and nothing at all when an edit's old text isn't there exactly once. How often it is there is counted
// exactly, overlaps included: an old text wrongly taken for unique would change the wrong place. One call is bounded
// in its edits, each old text and every text along the way, so none can stall the service.
import { MAX_EDIT_OLD_BYTES, MAX_EDITS, MAX_PROPOSAL_BYTES } from "@wombat/shared/proposals";
import fc from "fast-check";
import { expect, test } from "vitest";

import { applyEdits } from "./edits.ts";

const edit = (oldText: string, newText: string) => ({ oldText, newText });

// [what, the text, the edits, the resulting text or the problem]
const cases: [string, string, { oldText: string; newText: string }[], ReturnType<typeof applyEdits>][] = [
  ["a later edit works on what the earlier ones left", "Run npm install.\n", [edit("npm", "pnpm"), edit("pnpm install", "pnpm install --frozen-lockfile")], { text: "Run pnpm install --frozen-lockfile.\n" }],
  ["a later edit no longer finds what an earlier one replaced", "Run npm install.\n", [edit("npm", "pnpm"), edit("Run npm", "Use npm")], { problem: { edit: 2, matches: 0 } }],
  ["the new text is literal, replacement patterns included", "price: AMOUNT\n", [edit("AMOUNT", "$& $1 $$ $` $' $<name>")], { text: "price: $& $1 $$ $` $' $<name>\n" }],
  ["an old text found twice", "- item\n- item\n", [edit("- item\n", "- entry\n")], { problem: { edit: 1, matches: 2 } }],
  ["an old text found twice, overlapping", "aaa", [edit("aa", "b")], { problem: { edit: 1, matches: 2 } }],
  ["an empty old text", "alpha\n", [edit("alpha", "one"), edit("", "two")], { problem: { edit: 2, empty: true } }],
];

test.each(cases)("edits: %s", (_what, text, edits, expected) => {
  expect(applyEdits(text, edits)).toStrictEqual(expected);
});

// A small alphabet, mostly two letters, so an old text repeats and overlaps itself; the two emoji share their first
// code unit.
const letter = fc.constantFrom("a", "a", "a", "b", "b", "😀", "😁");
const letters = (minLength: number, maxLength: number) => fc.array(letter, { minLength, maxLength });
/** An old text, and a text made of it, of its starts and ends and of single letters, so it occurs often and overlapping. */
const oldAndText = letters(1, 10).chain((old) => {
  const cut = fc.nat({ max: old.length });
  const piece = fc.oneof(fc.constant(old), cut.map((at) => old.slice(0, at)), cut.map((at) => old.slice(at)), letters(1, 1));
  return fc.array(piece, { maxLength: 8 }).map((pieces) => ({ oldText: old.join(""), text: pieces.flat().join("") }));
});

test("an edit applies exactly when its old text occurs once, at that place, and else reports how often it occurs, overlaps counted", () => {
  fc.assert(
    fc.property(oldAndText, ({ oldText, text }) => {
      const starts = Array.from({ length: text.length }, (_unit, index) => index).filter((index) => text.startsWith(oldText, index));
      const [only = 0] = starts;
      const expected = starts.length === 1 ? { text: `${text.slice(0, only)}[new]${text.slice(only + oldText.length)}` } : { problem: { edit: 1, matches: starts.length } };

      expect(applyEdits(text, [edit(oldText, "[new]")])).toStrictEqual(expected);
    }),
    { numRuns: 2000 },
  );
});

test("one call takes at most MAX_EDITS edits, an old text of at most MAX_EDIT_OLD_BYTES of UTF-8, and no text along the way over MAX_PROPOSAL_BYTES", () => {
  // One more edit than a call takes, each of which would apply.
  const marks = Array.from({ length: MAX_EDITS + 1 }, (_value, n) => `[${String(n)}]`);
  const swaps = marks.map((mark, n) => edit(mark, `(${String(n)})`));
  expect(applyEdits(marks.join(" "), swaps.slice(0, MAX_EDITS)), "as many edits as a call takes").toHaveProperty("text");
  expect(applyEdits(marks.join(" "), swaps), "one edit more").toStrictEqual({ over: "edits" });

  // Fewer characters than the limit has bytes, but more bytes.
  const atLimit = "é".repeat(MAX_EDIT_OLD_BYTES / 2);
  expect(applyEdits(`# ${atLimit}\n`, [edit(atLimit, "short")]), "an old text of exactly the limit").toStrictEqual({ text: "# short\n" });
  expect(applyEdits(`# ${atLimit}é\n`, [edit("#", "##"), edit(`${atLimit}é`, "short")]), "an old text over the limit").toStrictEqual({ problem: { edit: 2, tooLong: true } });

  // The text ends within the limit again, so only the check along the way sees it.
  const full = `GROW ${"x".repeat(MAX_PROPOSAL_BYTES - 32)} SHRINK-AGAIN`;
  expect(applyEdits(full, [edit("SHRINK", "SHRUNK")]), "a text within the limit").toHaveProperty("text");
  expect(applyEdits(full, [edit("GROW", `GROWN ${"y".repeat(32)}`), edit(" SHRINK-AGAIN", "")]), "a text over the limit between two edits").toStrictEqual({ over: "text" });
});
