import type { AnswerPermissionRequest } from "@wombat/shared/api";
import { Check, ShieldQuestion, X } from "lucide-react";
import type { Ref } from "react";

import { Button } from "../../../../components/ui/button";
import type { ChatItem } from "../../../../data/chat-model.ts";
import { AGENT_STATES } from "../../../../lib/agent-state";
import { cn } from "../../../../lib/utils";
import { ANSWER_LABELS, permissionButtons } from "../permission-buttons.ts";

export type PermissionItem = Extract<ChatItem, { kind: "permission" }>;

type Props = {
  item: PermissionItem;
  /** The outcome as the chat shows it (`liveState(...).answerOf(item)`); undefined while the request is open. */
  answer: PermissionItem["answer"];
  /** An edit's request (its tool call holds a diff): the card is named "Edit approval". */
  edit: boolean;
  /** No answer can be sent now (not connected, or one is on its way). */
  disabled: boolean;
  error?: Error | undefined;
  onAnswer: (kind: AnswerPermissionRequest["kind"]) => void;
  /** The card, for a reveal to scroll to and focus. */
  cardRef?: Ref<HTMLElement> | undefined;
};

/** What the agent asks to do, from the request's title. */
const Title = ({ title }: { title: string }) => (
  <span className="min-w-0 truncate text-sm text-fg-primary">{title === "" ? "The agent asks for permission" : title}</span>
);

/**
 * A permission request at its place in the chat: open, its title and one button per option (Approve and Reject from
 * `permissionButtons`); answered or cancelled, its outcome and no buttons.
 */
export const Permission = ({ item, answer, edit, disabled, error, onAnswer, cardRef }: Props) => {
  const name = edit ? "Edit approval" : "Permission request";
  if (answer !== undefined) {
    const allowed = answer.startsWith("allow_");
    const Mark = allowed ? Check : X;
    return (
      <section ref={cardRef} tabIndex={-1} aria-label={name} className="focus-ring flex items-center gap-2 rounded-md border border-line px-3 py-1.5">
        <ShieldQuestion className="size-3.5 shrink-0 text-fg-secondary" />
        <Title title={item.title} />
        <span className="ml-auto flex shrink-0 items-center gap-1 rounded-sm bg-surface-3 px-1.5 py-0.5 text-xs text-fg-secondary">
          <Mark className="size-3" />
          {ANSWER_LABELS[answer]}
        </span>
      </section>
    );
  }
  const { approve, reject, others } = permissionButtons(item.options);
  const waiting = AGENT_STATES.waiting;
  return (
    <section ref={cardRef} tabIndex={-1} aria-label={name} className="focus-ring overflow-hidden rounded-lg border border-line-strong bg-surface-2">
      <header className="flex h-8 items-center gap-2 border-b border-line pr-1.5 pl-3">
        <ShieldQuestion className="size-3.5 shrink-0 text-fg-secondary" />
        <Title title={item.title} />
      </header>
      <footer className="flex flex-wrap items-center gap-2 py-1.5 pr-1.5 pl-3">
        <waiting.icon className={cn("size-3.5 shrink-0", waiting.colour)} />
        <span className="min-w-0 truncate text-sm text-fg-secondary">The agent waits for your answer</span>
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
      </footer>
      {error === undefined ? null : (
        <p role="alert" className="border-t border-line px-3 py-1.5 text-sm text-danger">
          Couldn't send the answer: {error.message}
        </p>
      )}
    </section>
  );
};
