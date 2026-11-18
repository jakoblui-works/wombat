import type { NoteOutcome, NoteOutcomeKind } from "@wombat/shared/api";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Collapse } from "../../../../components/ui/collapse";
import type { ChatItem } from "../../../../data/chat-model.ts";
import { DiffRows } from "../../approvals/EditDiff/EditDiff.tsx";
import { type StoredDiff, storedDiffRows } from "../../approvals/EditDiff/inline-diff.ts";
import { noteLine, OUTCOME_WORDS } from "./note-line.ts";

type NoteItem = Extract<ChatItem, { kind: "proposal_note" }>;

// As the service words them to the agent: my reason for a reject, a file conflict's problem.
const REASON_LABEL: Partial<Record<NoteOutcomeKind, string>> = { rejected: "Your reason", conflict: "The problem" };

/** A stored diff: its changed lines as the approval card shows them, and the fixed lines that go with them. */
const Diff = ({ part }: { part: StoredDiff }) => {
  const { rows, says } = storedDiffRows(part);
  return (
    <>
      {rows.length === 0 ? null : <DiffRows diff={{ kind: "shown", parts: [rows], added: 0, removed: 0 }} />}
      {says.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </>
  );
};

const Part = ({ title, part, reason }: { title: string | undefined; part: NoteOutcome | NonNullable<NoteItem["reference"]>; reason?: string | undefined }) => (
  <div className="flex flex-col gap-0.5">
    {title === undefined ? null : <span className="break-all">{title}</span>}
    {reason === undefined ? null : <span>{reason}</span>}
    <Diff part={part} />
  </div>
);

/** What the agent was told with the message after it: one quiet line, expanding to the outcomes and diffs it carried. */
export const ProposalNote = ({ note }: { note: NoteItem }) => {
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col gap-1 text-sm text-fg-tertiary">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="focus-ring -ml-1 flex w-fit max-w-full items-center gap-1.5 rounded-md px-1 text-left transition-colors hover:text-fg-secondary"
      >
        <Chevron className="size-3.5 shrink-0" />
        <span className="break-all">{noteLine(note)}</span>
      </button>
      <Collapse open={expanded}>
        <div className="ml-1.5 flex flex-col gap-2 border-l border-line pl-3">
          {note.outcomes.map((outcome) => {
            const label = REASON_LABEL[outcome.outcome];
            return (
              <Part
                key={outcome.proposalId}
                title={`${OUTCOME_WORDS[outcome.outcome].title}: ${outcome.label}`}
                part={outcome}
                reason={outcome.reason === undefined || label === undefined ? undefined : `${label}: ${outcome.reason}`}
              />
            );
          })}
          {note.reference === undefined ? null : <Part title={note.outcomes.length === 0 ? undefined : "Your changes"} part={note.reference} />}
        </div>
      </Collapse>
    </div>
  );
};
