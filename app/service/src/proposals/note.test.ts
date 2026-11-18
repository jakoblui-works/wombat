// What a note tells an agent about my own version of its proposal. The proposal's row says "edited by me" exactly
// when the version approved was mine, so the note must say "approved with changes" exactly then, or the agent is told
// its text was applied when it wasn't. And my changes are shown only while they are small: the diff is bounded before
// it is computed, since a note is built while the service handles a message.
import type { NoteOutcome, NoteReference } from "@wombat/shared/api";
import { MAX_PROPOSAL_BYTES, type ProposalStatus } from "@wombat/shared/proposals";
import { expect, test } from "vitest";

import type { ProposalContent, ProposalVersionRecord, StoredProposal } from "../store/store.ts";
import { NOTE_DIFF_LIMITS, noteFor, type NoteSubject } from "./note.ts";

const PATH = "/home/sam/work/site-web/docs/pairing-notes.md";
const AT = "2026-11-09T10:02:11.120Z";

const NOTES = "# Pairing notes\n\n- Driver and navigator swap after each finished test.\n- The navigator keeps the notes.\n";
const MY_LINE = "- Anyone but the driver keeps the notes.";
const MY_NOTES = NOTES.replace("- The navigator keeps the notes.", MY_LINE);

type By = ProposalVersionRecord["by"];

const versions = (...contents: [By, ProposalContent][]): ProposalVersionRecord[] =>
  contents.map(([by, content], index) => ({ n: index + 1, by, content, reason: by === "agent" ? "The rotation rule changed." : "", at: AT }));

const texts = (...given: [By, string][]) => versions(...given.map(([by, text]): [By, ProposalContent] => [by, { text }]));

/** A file proposal in `status` with `given` versions, as the note is built from it. */
const subject = (status: ProposalStatus, given: ProposalVersionRecord[], target: "file" | "item" = "file"): NoteSubject => {
  const common = { id: "0196f3c2-1a00-7000-8000-0000000000aa", file: null, reason: "The rotation rule changed.", baseVersion: "4d5e6f", status, agentId: "agent-1", at: AT };
  const stored: StoredProposal =
    target === "file"
      ? { ...common, target, itemId: null, path: PATH, binder: null, kind: "edit" }
      : { ...common, target, itemId: "0196f3c2-1a00-7000-8000-000000000002", path: null, binder: "bugs", kind: "update" };
  return { stored, versions: given, label: target === "file" ? PATH : "BUG-2" };
};

/** The one outcome a note tells for `told`. */
const outcomeOf = (told: NoteSubject): NoteOutcome => {
  const outcomes = noteFor([told], undefined)?.outcomes ?? [];
  expect(outcomes).toHaveLength(1);
  return outcomes[0] as NoteOutcome;
};

/** What an outcome carries of my changes: no diff, a diff without a line (only the final newline differs), or my line. */
type Shown = "no diff" | "an empty diff" | "my line";

// [what, the status, the versions, the target, the outcome told, my changes]
const OUTCOMES: [string, ProposalStatus, ProposalVersionRecord[], "file" | "item", NoteOutcome["outcome"], Shown][] = [
  ["the agent's only version", "approved", texts(["agent", NOTES]), "file", "approved", "no diff"],
  ["my version with a changed line", "approved", texts(["agent", NOTES], ["me", MY_NOTES]), "file", "approved_with_changes", "my line"],
  ["my version without the final newline", "approved", texts(["agent", NOTES], ["me", NOTES.slice(0, -1)]), "file", "approved_with_changes", "an empty diff"],
  ["my version with one more final newline", "approved", texts(["agent", NOTES.slice(0, -1)], ["me", NOTES]), "file", "approved_with_changes", "an empty diff"],
  ["the agent's revision after my version", "approved", texts(["agent", NOTES], ["me", MY_NOTES], ["agent", `${MY_NOTES}- Swap seats too.\n`]), "file", "approved", "no diff"],
  ["my version of an item's fields", "approved", versions(["agent", { fields: { note: "Seen in Zen" } }], ["me", { fields: { note: "Seen in Zen at every width" } }]), "item", "approved_with_changes", "no diff"],
  ["a reject while my version was current", "rejected", texts(["agent", NOTES], ["me", MY_NOTES]), "file", "rejected", "no diff"],
  ["a conflict on my version", "conflict", texts(["agent", NOTES], ["me", MY_NOTES]), "file", "conflict", "no diff"],
];

test.each(OUTCOMES)("the outcome told for %s", (_what, status, given, target, outcome, shown) => {
  const told = outcomeOf(subject(status, given, target));

  expect(told.outcome).toBe(outcome);
  expect(told.diffTooLarge).toBeUndefined();
  if (shown === "no diff") expect(told.diff).toBeUndefined();
  else expect(told.diff?.filter((line) => line.kind === "added").map((line) => line.text)).toEqual(shown === "my line" ? [MY_LINE] : []);
  if (shown === "an empty diff") expect(told.diff).toEqual([]);
});

const line = (n: number) => `Step ${String(n)} of the release checklist.`;
const numbered = (count: number) => Array.from({ length: count }, (_, index) => line(index + 1));
const textOf = (lines: readonly string[]) => lines.map((each) => `${each}\n`).join("");

/** `count` copies of a two-byte line, to the proposal size limit. */
const fill = (letter: string) => `${letter}\n`.repeat(MAX_PROPOSAL_BYTES / 2);

test("my changes are shown while they are small; past any limit the note says they are too large and carries no diff", () => {
  const { changes, lines, context, bytes } = NOTE_DIFF_LIMITS;
  const base = numbered(lines * (2 * context + 2));
  /** `base` with a line of mine after every `every`th line, `count` times. */
  const withMine = (count: number, every: number) => base.flatMap((each, index) => (index % every === 0 && index / every < count ? [each, `Mine ${String(index)}.`] : [each]));
  /** What an outcome and a message's reference tell of my version `mine` of `theirs`. */
  const told = (theirs: string, mine: string): [NoteOutcome, NoteReference] => {
    const given = texts(["agent", theirs], ["me", mine]);
    const note = noteFor([subject("approved", given)], subject("pending", given));
    expect(note?.reference).toBeDefined();
    return [note?.outcomes[0] as NoteOutcome, note?.reference as NoteReference];
  };

  for (const entry of told(textOf(base), textOf(withMine(1, 1)))) {
    expect(entry.diff?.filter((each) => each.kind === "added")).toHaveLength(1);
    expect(entry.diffTooLarge).toBeUndefined();
  }

  // The first is small with its context, so only counting the changed lines refuses it; the last is a whole rewrite
  // at the size limit, whose diff must not be computed to the end before it is found too large.
  const tooLarge: [string, string, string][] = [
    ["more changed lines in a row than a note keeps", textOf(base), textOf([...numbered(changes + 1).map((each) => `Mine: ${each}`), ...base])],
    ["more lines with their context than a note keeps", textOf(base), textOf(withMine(Math.floor(lines / (1 + 2 * context)) + 1, 2 * context + 2))],
    ["one changed line longer than a note keeps", textOf(base), textOf([...base, "x".repeat(bytes + 1)])],
    ["a whole rewrite at the proposal size limit", fill("a"), fill("b")],
  ];
  for (const [what, theirs, mine] of tooLarge) {
    for (const entry of told(theirs, mine)) {
      expect(entry.diffTooLarge, what).toBe(true);
      expect(Object.keys(entry).filter((key) => key === "diff" || key === "diffContinues"), what).toEqual([]);
    }
  }
});
