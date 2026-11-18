// What an agent is told about its proposals, pure: the note that travels in front of the user's next message (the
// outcomes it hasn't been told, and the proposal the message is about) and the text it reads. The log stores the note;
// the prompt is `renderNote` of it followed by the typed text, so what the agent read can be rebuilt from the log.
import { NoteOutcomeKind, type NoteOutcome, type NoteReference, type ProposalNoteEntry } from "@wombat/shared/api";
import { lineDiffWithin, withContext, type DiffLine } from "@wombat/shared/line-diff";
import { myDraft, type ProposalStatus } from "@wombat/shared/proposals";

import { TOOL } from "../items/tools.ts";
import { OUTCOMES } from "../store/proposal-rules.ts";
import type { ProposalVersionRecord, StoredProposal } from "../store/store.ts";

export type ProposalNote = Pick<ProposalNoteEntry, "outcomes"> & { reference?: NoteReference };

/**
 * A proposal as the note is built from it: what is stored, the versions a note reads (my current draft and the
 * agent's version it edits; none needed otherwise), and its label for the agent.
 */
export type NoteSubject = { stored: StoredProposal; versions: readonly ProposalVersionRecord[]; label: string };

/**
 * How much of my changes a note keeps: unchanged lines around each change; past `changes` lines removed and added,
 * or `lines` or `bytes` kept, the note says they are too large instead.
 */
export const NOTE_DIFF_LIMITS = { context: 2, changes: 100, lines: 200, bytes: 16 * 1024 } as const;

/** Whether a message carries a note: not a command (a leading `/`), which a note in front would stop being one. */
export const carriesNote = (text: string) => !text.startsWith("/");

/** An item proposal's label when the agent may not be told a handle: a create that made nothing, or any other. */
export const itemLabel = (kind: StoredProposal["kind"], handle: string | undefined) => handle ?? (kind === "create" ? "a new item" : "an item");

/** What the agent is told each outcome status is: the kind of the same name. An outcome status without one fails here, when the service loads. */
const OUTCOME_OF: ReadonlyMap<ProposalStatus, NoteOutcomeKind> = new Map(OUTCOMES.map((status) => [status, NoteOutcomeKind.exclude(["approved_with_changes"]).parse(status)]));

/** My changes as a note keeps them: the same text, none in any line, too large to keep, or the lines shown; unknown for an item. */
type MyChanges = "same" | "none" | "unknown" | "too_large" | { diff: DiffLine[]; continues: boolean };

/** `from` against `to` within NOTE_DIFF_LIMITS. */
const boundedChanges = (from: string, to: string): MyChanges => {
  if (from === to) return "same";
  const all = lineDiffWithin(from, to, NOTE_DIFF_LIMITS.changes);
  if (all === undefined) return "too_large";
  const diff = withContext(all, NOTE_DIFF_LIMITS.context).flatMap((index) => all[index] ?? []);
  if (diff.length === 0) return "none";
  const bytes = diff.reduce((sum, line) => sum + Buffer.byteLength(line.text), 0);
  if (diff.length > NOTE_DIFF_LIMITS.lines || bytes > NOTE_DIFF_LIMITS.bytes) return "too_large";
  return { diff, continues: diff.at(-1) !== all.at(-1) };
};

/**
 * My changes to the agent's version when my version is current (undefined otherwise): the file text of the latest
 * agent version before it against mine. Unknown for an item, whose fields hold ids an agent never reads.
 */
const myChanges = (versions: readonly ProposalVersionRecord[]): MyChanges | undefined => {
  const draft = myDraft(versions);
  if (draft === undefined) return undefined;
  const { mine, theirs } = draft;
  if (!("text" in theirs.content) || !("text" in mine.content)) return "unknown";
  return boundedChanges(theirs.content.text, mine.content.text);
};

/** Called when my changes to a proposal couldn't be worked out; the note then says they are too large to show. */
type DiffFailed = (proposalId: string, error: unknown) => void;

const changesOf = ({ stored, versions }: NoteSubject, failed: DiffFailed | undefined): MyChanges | undefined => {
  try {
    return myChanges(versions);
  } catch (error) {
    failed?.(stored.id, error);
    return "too_large";
  }
};

const diffFields = (changes: MyChanges | undefined): Pick<NoteOutcome, "diff" | "diffContinues" | "diffTooLarge"> => {
  if (changes === "too_large") return { diffTooLarge: true };
  if (changes === "none") return { diff: [] };
  if (typeof changes !== "object") return {};
  return { diff: changes.diff, ...(changes.continues ? { diffContinues: true } : {}) };
};

/**
 * What the agent is told of an outcome's reason: mine for a reject; a file conflict's stored problem. An item
 * conflict's stored problem is told by nothing: it was worded for the user and may name a binder hidden from the
 * agent, and it keeps no record of what it names for the items' scrubbing to judge.
 */
const reasonOf = (stored: StoredProposal, outcome: NoteOutcome["outcome"]): string | undefined => {
  if (outcome === "rejected") return stored.rejectReason === "" ? undefined : stored.rejectReason;
  if (outcome === "conflict" && stored.target === "file") return stored.problem?.message;
  return undefined;
};

const outcomeOf = (subject: NoteSubject, failed: DiffFailed | undefined): NoteOutcome | undefined => {
  const { stored, label } = subject;
  const told = OUTCOME_OF.get(stored.status);
  if (told === undefined) return undefined;
  const mine = told === "approved" && myDraft(subject.versions) !== undefined;
  const changes = mine ? changesOf(subject, failed) : undefined;
  const outcome = mine ? "approved_with_changes" : told;
  const reason = reasonOf(stored, outcome);
  return { proposalId: stored.id, label, outcome, ...(reason === undefined ? {} : { reason }), ...diffFields(changes) };
};

/** The note for `outcomes` (proposals the agent hasn't been told about) and the message's `reference`; undefined when there's nothing to tell. */
export const noteFor = (outcomes: readonly NoteSubject[], reference: NoteSubject | undefined, failed?: DiffFailed): ProposalNote | undefined => {
  const told = outcomes.flatMap((subject) => outcomeOf(subject, failed) ?? []);
  const about: NoteReference | undefined =
    reference === undefined ? undefined : { proposalId: reference.stored.id, label: reference.label, ...diffFields(changesOf(reference, failed)) };
  if (told.length === 0 && about === undefined) return undefined;
  return { outcomes: told, ...(about === undefined ? {} : { reference: about }) };
};

/** `text` with every line break as "\n" (a lone "\r" too, which would break the note's lines), later lines indented `by`. */
const indented = (text: string, by: string) => text.replaceAll(/\r\n?/g, "\n").replaceAll("\n", `\n${by}`);

const SIGN: Record<DiffLine["kind"], string> = { context: " ", removed: "-", added: "+" };
const DIFF_INDENT = "    ";
const OMITTED = `${DIFF_INDENT}…`;

/** A diff as indented lines, `-` removed, `+` added, with `…` where unchanged lines were left out. */
const renderDiff = (lines: readonly DiffLine[], continues: boolean) => {
  const out: string[] = [];
  let lastOld = 0;
  let lastNew = 0;
  for (const line of lines) {
    const old = "oldLine" in line ? line.oldLine : undefined;
    const now = "newLine" in line ? line.newLine : undefined;
    const follows = (old !== undefined && old === lastOld + 1) || (now !== undefined && now === lastNew + 1);
    if (!follows && (lastOld > 0 || lastNew > 0 || (old ?? now ?? 1) > 1)) out.push(OMITTED);
    out.push(`${DIFF_INDENT}${SIGN[line.kind]} ${indented(line.text, `${DIFF_INDENT}  `)}`);
    lastOld = old ?? lastOld;
    lastNew = now ?? lastNew;
  }
  if (continues) out.push(OMITTED);
  return out.join("\n");
};

/** The lines that show my changes in an outcome or a reference: `intro` and the diff, `tooLarge`, or `newlineOnly` when no line changed. */
const renderChanges = ({ diff, diffContinues, diffTooLarge }: NoteReference, intro: string, tooLarge: string, newlineOnly: string) => {
  if (diffTooLarge === true) return [tooLarge];
  if (diff === undefined) return [];
  return diff.length === 0 ? [newlineOnly] : [intro, renderDiff(diff, diffContinues === true)];
};

const OUTCOME_TEXT: Record<NoteOutcome["outcome"], string> = {
  approved: "approved; it was applied as you proposed it.",
  approved_with_changes: "approved with the user's own changes, so what was applied differs from your version.",
  rejected: "rejected; nothing was applied.",
  conflict: `a conflict; nothing was applied. Revise it with ${TOOL.reviseProposal} to fit the target as it is now, or leave it to the user.`,
};

const renderOutcome = (told: NoteOutcome) => {
  const { proposalId, label, outcome, reason } = told;
  const lines = [`- ${indented(label, "  ")} (proposal ${proposalId}): ${OUTCOME_TEXT[outcome]}`];
  if (reason !== undefined) lines.push(`  ${outcome === "rejected" ? "The user's reason" : "The problem"}: ${indented(reason, "  ")}`);
  else if (outcome === "rejected") lines.push("  The user gave no reason.");
  lines.push(
    ...renderChanges(
      told,
      "  The user's changes:",
      "  The user's changes are too large to show here; read the file to see what was applied.",
      "  The user changed only the final newline; every line was applied as you proposed it.",
    ),
  );
  return lines.join("\n");
};

const renderReference = (reference: NoteReference) =>
  [
    `[Wombat] The user's message asks for changes to your proposal ${reference.proposalId} (${indented(reference.label, "  ")}); revise it with ${TOOL.reviseProposal}.`,
    ...renderChanges(
      reference,
      "The user has edited it; their version differs from yours:",
      "The user has edited it, but their changes are too large to show here and aren't in the file yet; ask the user what they changed.",
      "The user has edited it, but only its final newline; every line reads as in your version.",
    ),
  ].join("\n");

const HEADER = "[Wombat] The user decided on these proposals of yours:";
const CLOSING = "[Wombat] The user's message follows.";

/** The text the agent reads in front of the user's message: the one rendering of a stored note. */
export const renderNote = ({ outcomes, reference }: ProposalNote): string => {
  const parts: string[] = [];
  if (outcomes.length > 0) parts.push([HEADER, ...outcomes.map(renderOutcome)].join("\n"));
  if (reference !== undefined) parts.push(renderReference(reference));
  parts.push(CLOSING);
  return parts.join("\n\n");
};

/** The prompt for a message: its note's rendering, then the typed text. */
export const promptOf = (note: ProposalNote | undefined, text: string) => (note === undefined ? text : `${renderNote(note)}\n\n${text}`);
