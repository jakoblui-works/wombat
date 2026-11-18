import type { AnswerPermissionRequest } from "@wombat/shared/api";
import { ChevronDown, ChevronRight, Columns2, FilePen, type LucideIcon, ShieldQuestion } from "lucide-react";
import { type Ref, useState } from "react";

import { Button } from "../../../../components/ui/button";
import { Collapse } from "../../../../components/ui/collapse";
import type { ChatItem } from "../../../../data/chat-model.ts";
import { cn } from "../../../../lib/utils";
import { AnswerButtons, AnswerError, EditTarget, Outcome, Waiting } from "../../approvals/Answer/Answer.tsx";
import { DiffRows, useInlineDiff } from "../../approvals/EditDiff/EditDiff.tsx";
import type { InlineDiff } from "../../approvals/EditDiff/inline-diff.ts";
import type { EditRequest } from "../../approvals/edit-request.ts";
import { hasDetails, KIND_ICONS, ToolDetails, type ToolItem } from "../ToolCall/ToolCall.tsx";

export type PermissionItem = Extract<ChatItem, { kind: "permission" }>;

/** The file and diffs an edit's request asks to apply (from `editRequest`). */
export type EditDiffData = Pick<EditRequest, "path" | "diffs">;

type Props = {
  item: PermissionItem;
  /** The outcome as the chat shows it (`liveState(...).answerOf(item)`); undefined while the request is open. */
  answer: PermissionItem["answer"];
  /** An edit's request (its tool call holds a diff, by `editRequest`): the card is named "Edit approval" and shows it. */
  edit: false | EditDiffData;
  /** The tool call the request asks about: the card stands for it, so its output stays reachable from the card. */
  tool?: ToolItem | undefined;
  /** No answer can be sent now (not connected, or one is on its way). */
  disabled: boolean;
  error?: Error | undefined;
  onAnswer: (kind: AnswerPermissionRequest["kind"]) => void;
  /** Opens the edit in its diff tab, beside the chat. */
  onOpenSideBySide?: (() => void) | undefined;
  /** The card, for a reveal to scroll to and focus. */
  cardRef?: Ref<HTMLElement> | undefined;
};

/** What the agent asks to do, from the request's title. */
const Title = ({ title }: { title: string }) => (
  <span className="min-w-0 truncate text-sm text-fg-primary">{title === "" ? "The agent asks for permission" : title}</span>
);

const NO_DIFFS: EditDiffData["diffs"] = [];

/** An edit's open request: the file, its compact diff, and the answer buttons; too large to show, only side by side. */
const OpenEdit = ({ name, edit, diff, item, disabled, error, onAnswer, onOpenSideBySide, cardRef }: Props & { name: string; edit: EditDiffData; diff: InlineDiff }) => (
  <section ref={cardRef} tabIndex={-1} aria-label={name} className="focus-ring overflow-hidden rounded-lg border border-line-strong bg-surface-2">
    <header className="flex h-8 items-center gap-2 border-b border-line pr-1.5 pl-3">
      <FilePen className="size-3.5 shrink-0 text-fg-secondary" />
      <EditTarget path={edit.path} diff={diff} />
      {onOpenSideBySide === undefined ? null : (
        <Button variant="secondary" size="sm" className="ml-auto" onClick={onOpenSideBySide}>
          <Columns2 />
          Open side by side
        </Button>
      )}
    </header>
    <DiffRows diff={diff} />
    <footer className="flex flex-wrap items-center gap-2 border-t border-line py-1.5 pr-1.5 pl-3">
      {diff.kind === "too-large" ? (
        <Waiting wrap>The agent waits for your answer; review the change side by side to give it</Waiting>
      ) : (
        <>
          <Waiting />
          <AnswerButtons options={item.options} disabled={disabled} onAnswer={onAnswer} />
        </>
      )}
    </footer>
    <AnswerError error={error} />
  </section>
);

/**
 * A permission request at its place in the chat, standing for the tool call it asks about: open, its title (an edit:
 * its file and diff) and one button per option (Approve and Reject from `permissionButtons`); answered or cancelled,
 * one row with its outcome and no answer buttons, which expands to the tool call's details when there are any.
 */
export const Permission = (props: Props) => {
  const { item, answer, edit, tool, disabled, error, onAnswer, cardRef } = props;
  const [expanded, setExpanded] = useState(false);
  const diff = useInlineDiff(edit === false ? NO_DIFFS : edit.diffs);
  const name = edit === false ? "Permission request" : "Edit approval";
  const Icon: LucideIcon = edit !== false ? FilePen : tool === undefined ? ShieldQuestion : KIND_ICONS[tool.toolKind];
  const details = tool !== undefined && hasDetails(tool);
  const target = edit === false ? <Title title={item.title} /> : <EditTarget path={edit.path} diff={diff} />;

  if (answer !== undefined) {
    const row = (
      <>
        <Icon className="size-3.5 shrink-0 text-fg-secondary" />
        {target}
        <Outcome answer={answer} />
      </>
    );
    const Chevron = expanded ? ChevronDown : ChevronRight;
    return (
      <section ref={cardRef} tabIndex={-1} aria-label={name} className="focus-ring overflow-hidden rounded-md border border-line">
        {details ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="focus-ring flex w-full items-center gap-2 py-1.5 pr-3 pl-2.5 text-left transition-colors hover:bg-surface-2"
          >
            <Chevron className="size-3.5 shrink-0 text-fg-tertiary" />
            {row}
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5">{row}</div>
        )}
        {details ? (
          <Collapse open={expanded}>
            <ToolDetails item={tool} />
          </Collapse>
        ) : null}
      </section>
    );
  }

  if (edit !== false) return <OpenEdit {...props} name={name} edit={edit} diff={diff} />;
  return (
    <section ref={cardRef} tabIndex={-1} aria-label={name} className="focus-ring overflow-hidden rounded-lg border border-line-strong bg-surface-2">
      <header className={cn("flex h-8 items-center gap-2 pr-1.5 pl-3", details ? undefined : "border-b border-line")}>
        <Icon className="size-3.5 shrink-0 text-fg-secondary" />
        <Title title={item.title} />
      </header>
      {details ? <ToolDetails item={tool} /> : null}
      <footer className="flex flex-wrap items-center gap-2 py-1.5 pr-1.5 pl-3">
        <Waiting />
        <AnswerButtons options={item.options} disabled={disabled} onAnswer={onAnswer} />
      </footer>
      <AnswerError error={error} />
    </section>
  );
};
