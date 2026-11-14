// An approve writes exactly the text the edits describe: each edit on what the earlier ones left, the new text as
// typed, and nothing at all when an edit's old text isn't there exactly once.
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
