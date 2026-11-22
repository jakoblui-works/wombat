import type { NoteOutcomeKind } from "@wombat/shared/api";
import type { ChatPart } from "../../../../data/chat-model.ts";

type NotePart = Extract<ChatPart, { kind: "proposal_note" }>;

/** Each outcome kind's word: counted in the line, and as a title in the expanded note. A new kind fails to compile until it has both. */
export const OUTCOME_WORDS: Record<NoteOutcomeKind, { counted: "approved" | "rejected" | "in conflict"; title: string }> = {
  approved: { counted: "approved", title: "Approved" },
  approved_with_changes: { counted: "approved", title: "Approved with changes" },
  rejected: { counted: "rejected", title: "Rejected" },
  conflict: { counted: "in conflict", title: "Conflict" },
};

const COUNT_ORDER = ["approved", "rejected", "in conflict"] as const;

/** The one line a note shows, from its stored fields: "Told the agent: 2 approved, 1 rejected", "Asked about <label>", or both. */
export const noteLine = ({ outcomes, reference }: Pick<NotePart, "outcomes" | "reference">): string => {
  const counts = COUNT_ORDER.map((word) => ({ word, count: outcomes.filter(({ outcome }) => OUTCOME_WORDS[outcome].counted === word).length })).filter(({ count }) => count > 0);
  const told = counts.length === 0 ? undefined : `Told the agent: ${counts.map(({ count, word }) => `${String(count)} ${word}`).join(", ")}`;
  const asked = reference === undefined ? undefined : `Asked about ${reference.label}`;
  return [told, asked].filter((part) => part !== undefined).join(". ");
};
