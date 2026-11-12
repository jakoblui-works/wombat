import type { AnswerPermissionRequest } from "@wombat/shared/api";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../../components/ui/button";
import type { ChatItem } from "../../../../data/chat-model.ts";
import { AGENT_STATES } from "../../../../lib/agent-state";
import { cn } from "../../../../lib/utils";
import { DiffCounts } from "../EditDiff/EditDiff.tsx";
import type { InlineDiff } from "../EditDiff/inline-diff.ts";
import { ANSWER_LABELS, type PermissionOption, permissionButtons } from "../permission-buttons.ts";

/** How an answered or cancelled request reads in place of its buttons. */
export const Outcome = ({ answer }: { answer: NonNullable<Extract<ChatItem, { kind: "permission" }>["answer"]> }) => {
  const Mark = answer.startsWith("allow_") ? Check : X;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 rounded-sm bg-surface-3 px-1.5 py-0.5 text-xs text-fg-secondary">
      <Mark className="size-3" />
      {ANSWER_LABELS[answer]}
    </span>
  );
};

/** One button per option: the rest by name, then Reject (secondary), then Approve (primary), from `permissionButtons`. */
export const AnswerButtons = ({
  options,
  disabled,
  onAnswer,
}: {
  options: readonly PermissionOption[];
  disabled: boolean;
  onAnswer: (kind: AnswerPermissionRequest["kind"]) => void;
}) => {
  const { approve, reject, others } = permissionButtons(options);
  return (
    <span className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
      {others.map((option, index) => (
        <Button key={`${String(index)}:${option.kind}:${option.name}`} variant="secondary" size="sm" disabled={disabled} onClick={() => onAnswer(option.kind)}>
          {option.name}
        </Button>
      ))}
      {reject === undefined ? null : (
        <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onAnswer(reject.kind)}>
          Reject
        </Button>
      )}
      {approve === undefined ? null : (
        <Button size="sm" disabled={disabled} onClick={() => onAnswer(approve.kind)}>
          Approve
        </Button>
      )}
    </span>
  );
};

/** "The agent waits for your answer", in the waiting state's look. */
export const Waiting = ({ children = "The agent waits for your answer", wrap = false }: { children?: ReactNode; wrap?: boolean }) => {
  const waiting = AGENT_STATES.waiting;
  return (
    <>
      <waiting.icon className={cn("size-3.5 shrink-0", waiting.colour)} />
      <span className={cn("min-w-0 text-sm text-fg-secondary", wrap ? undefined : "truncate")}>{children}</span>
    </>
  );
};

/** Why the last answer failed, as a strip along the card (`className` gives the side its border is on). */
export const AnswerError = ({ error, className = "border-t" }: { error: Error | undefined; className?: string }) =>
  error === undefined ? null : (
    <p role="alert" className={cn("border-line px-3 py-1.5 text-sm text-danger", className)}>
      Couldn't send the answer: {error.message}
    </p>
  );

/** An edit's file and, given its inline diff, its +/− counts: the card's header and the diff tab's. */
export const EditTarget = ({ path, diff }: { path: string; diff?: InlineDiff | undefined }) => (
  <>
    <span className="shrink-0 text-sm font-medium text-fg-primary">Edit</span>
    <code className="min-w-0 truncate font-mono text-xs text-fg-secondary">{path}</code>
    {diff?.kind === "shown" && diff.parts.length > 0 ? <DiffCounts diff={diff} /> : null}
  </>
);
