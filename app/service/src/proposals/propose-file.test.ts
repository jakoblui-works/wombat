// What a revised file version is made on. An approve on a file that changed since re-applies the version's stored
// edits to the file as it is now, so a version must store exactly the edits that lead from the proposal's base to its
// text, or none: a revise that dropped the earlier edits would re-apply only its own, and one that kept edits beside
// a text they don't produce would write a text nobody approved. A pending proposal keeps its base; only a conflict's
// revise, made on the file as it is now, moves it. A chain that outgrew what one approve applies is not stored at
// all, so approving on a changed file conflicts instead of re-applying part of it.
import { MAX_EDITS, MAX_PROPOSAL_BYTES } from "@wombat/shared/proposals";
import { expect, test } from "vitest";

import { fileRevision, type RevisionBase } from "./propose-file.ts";

const FILE = "# Pairing notes\n\n- Driver and navigator swap every half hour.\n- The navigator keeps the notes.\n";
const FIRST = { oldText: "swap every half hour", newText: "swap after each finished test" };
const PROPOSED = FILE.replace(FIRST.oldText, FIRST.newText);
/** An edit whose old text only the proposed text has. */
const SECOND = { oldText: "after each finished test", newText: "after every second finished test" };
const REVISED = PROPOSED.replace(SECOND.oldText, SECOND.newText);
const WHOLE = "# Pairing notes\n\nSwap whenever it suits you.\n";
/** The file after a hand edit, as a conflict's revise reads it, and an edit that fits it. */
const FILE_NOW = FILE.replace("every half hour", "every twenty minutes");
const ON_NOW = { oldText: "every twenty minutes", newText: "every twenty minutes, or after each finished test" };

const onAgentVersion: RevisionBase = { text: PROPOSED, source: "proposal", chain: [FIRST] };
const onMyDraft: RevisionBase = { text: PROPOSED, source: "proposal", chain: undefined };
const onFileNow: RevisionBase = { text: FILE_NOW, source: "fileNow", baseVersion: "9f2c", chain: [] };

// [what, what the version is made on, the change asked for, the new text, the edits stored, the new base (absent: kept)]
const CASES: [string, RevisionBase, Parameters<typeof fileRevision>[1], string, unknown[] | undefined, { baseVersion: string } | Record<string, never>][] = [
  ["edits on the agent's pending version extend its edits and keep the base", onAgentVersion, { edits: [SECOND] }, REVISED, [FIRST, SECOND], {}],
  ["content on a pending version stores no edits and keeps the base", onAgentVersion, { content: WHOLE }, WHOLE, undefined, {}],
  ["edits on my draft store no edits and keep the base", onMyDraft, { edits: [SECOND] }, REVISED, undefined, {}],
  ["edits on a conflict's file as it is now start a new chain on a new base", onFileNow, { edits: [ON_NOW] }, FILE_NOW.replace(ON_NOW.oldText, ON_NOW.newText), [ON_NOW], { baseVersion: "9f2c" }],
  ["content on a conflict's file as it is now stores no edits, on a new base", onFileNow, { content: WHOLE }, WHOLE, undefined, { baseVersion: "9f2c" }],
];

test.each(CASES)("%s", (_what, base, asked, text, edits, based) => {
  const { content, ...rest } = fileRevision(base, asked);

  expect(content.text).toBe(text);
  expect(content.edits).toEqual(edits);
  expect(rest).toEqual(based);
});

const bytesOf = (edits: readonly { oldText: string; newText: string }[]) => edits.reduce((sum, { oldText, newText }) => sum + Buffer.byteLength(oldText) + Buffer.byteLength(newText), 0);
/** A chain of one edit that, with SECOND after it, holds `bytes` bytes of old and new text. */
const chainOfBytes = (bytes: number) => [{ oldText: "é", newText: "x".repeat(bytes - bytesOf([SECOND]) - Buffer.byteLength("é")) }];

// [what, the chain the revise extends by SECOND, whether the new version stores the whole chain]
const CHAINS: [string, { oldText: string; newText: string }[], boolean][] = [
  ["as many edits as one call applies", Array.from({ length: MAX_EDITS - 1 }, () => FIRST), true],
  ["one edit more than one call applies", Array.from({ length: MAX_EDITS }, () => FIRST), false],
  ["old and new texts of exactly the largest text's bytes", chainOfBytes(MAX_PROPOSAL_BYTES), true],
  ["old and new texts one byte over the largest text", chainOfBytes(MAX_PROPOSAL_BYTES + 1), false],
];

test.each(CHAINS)("a revise whose chain of edits reaches %s stores the whole chain or no edits at all, beside the revised text", (_what, chain, stored) => {
  const { content } = fileRevision({ text: PROPOSED, source: "proposal", chain }, { edits: [SECOND] });

  expect(content.text).toBe(REVISED);
  expect(content.edits).toEqual(stored ? [...chain, SECOND] : undefined);
});
