import {
  ArrowLeftRight,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  FilePen,
  FileText,
  Globe,
  LoaderCircle,
  type LucideIcon,
  MoveRight,
  Search,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";

import type { ChatItem, ToolCallContent, ToolCallStatus, ToolKind } from "../../../../data/chat-model.ts";
import { cn } from "../../../../lib/utils";
import { EditDiff } from "../EditDiff/EditDiff.tsx";
import { Markdown } from "../Markdown/Markdown.tsx";
import { Omitted, useClipped } from "../Omitted/Omitted.tsx";

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;

export const KIND_ICONS: Readonly<Record<ToolKind, LucideIcon>> = {
  read: FileText,
  edit: FilePen,
  delete: Trash2,
  move: MoveRight,
  search: Search,
  execute: Terminal,
  think: Brain,
  fetch: Globe,
  switch_mode: ArrowLeftRight,
  other: Wrench,
};

const STATUS_LOOK: Readonly<Record<ToolCallStatus, { label: string; icon: LucideIcon; className: string }>> = {
  pending: { label: "Pending", icon: Circle, className: "text-fg-tertiary" },
  in_progress: { label: "Running", icon: LoaderCircle, className: "motion-spin text-state-working" },
  completed: { label: "Done", icon: Check, className: "text-fg-tertiary" },
  failed: { label: "Failed", icon: X, className: "text-danger" },
};

/** A tool's input or output as text: a string as it is, anything else as JSON. */
const asText = (value: unknown): string => (typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value)));

const Detail = ({ label, text }: { label: string; text: string }) => {
  const { shown, omitted, showAll, textRef } = useClipped<HTMLElement>(text);
  return (
    <div className="flex gap-3">
      <dt className="w-11 shrink-0 pt-1 text-xs font-medium text-fg-tertiary">{label}</dt>
      <dd ref={textRef} tabIndex={-1} className="min-w-0 flex-1 outline-none">
        <pre className="max-h-96 overflow-auto rounded-md border border-line-subtle bg-surface-0 px-2.5 py-1 font-mono text-xs whitespace-pre text-fg-secondary">{shown}</pre>
        <Omitted count={omitted} onShowAll={showAll} />
      </dd>
    </div>
  );
};

/** One piece of the tool call's content: text as Markdown (which clips it), a diff inline; a terminal by name only. */
const Content = ({ content }: { content: ToolCallContent }) => {
  if (content.type === "content") {
    if (content.content.type !== "text") return <p className="text-xs text-fg-tertiary">({content.content.type} content isn't shown)</p>;
    return <Markdown text={content.content.text} className="text-sm text-fg-secondary" />;
  }
  if (content.type === "diff") return <EditDiff path={content.path} oldText={content.oldText} newText={content.newText} />;
  return <p className="text-xs text-fg-tertiary">Terminal output isn't shown yet.</p>;
};

/** Whether a tool call has more to show than its row: input, output or content. */
export const hasDetails = (item: ToolItem): boolean => item.input !== undefined || item.output !== undefined || item.content.length > 0;

/** A tool call's input, output and content, as its expanded row (and an answered permission's) shows them. */
export const ToolDetails = ({ item }: { item: ToolItem }) => (
  <dl className="flex flex-col gap-1 border-t border-line-subtle px-2.5 pt-1.5 pb-2 pl-8">
    {item.input === undefined ? null : <Detail label="Input" text={asText(item.input)} />}
    {item.output === undefined ? null : <Detail label="Output" text={asText(item.output)} />}
    {item.content.map((content, index) => (
      <Content key={index} content={content} />
    ))}
    {hasDetails(item) ? null : <p className="text-xs text-fg-tertiary">Nothing more to show.</p>}
  </dl>
);

/** One tool call: a one-line row (tool, target, status); expanded, its input, output and content below. */
const ToolRow = ({ item }: { item: ToolItem }) => {
  const [expanded, setExpanded] = useState(false);
  const KindIcon = KIND_ICONS[item.toolKind];
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const status = item.status === undefined ? undefined : STATUS_LOOK[item.status];
  // The first location, unless the title already names it.
  const location = item.locations[0]?.path;
  const target = location === undefined || item.title.includes(location) ? undefined : location;
  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="focus-ring flex h-7 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors hover:bg-surface-2"
      >
        <Chevron className="size-3.5 shrink-0 text-fg-tertiary" />
        <KindIcon className="size-3.5 shrink-0 text-fg-secondary" />
        <span className="min-w-0 shrink truncate font-medium text-fg-secondary">{item.title === "" ? "Tool call" : item.title}</span>
        {target === undefined ? null : <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-primary">{target}</code>}
        {status === undefined ? null : (
          <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-xs text-fg-tertiary">
            <status.icon aria-label={status.label} className={cn("size-3.5", status.className)} />
          </span>
        )}
      </button>
      {expanded ? <ToolDetails item={item} /> : null}
    </li>
  );
};

/** Consecutive tool calls, collapsed to one line each. */
export const ToolCalls = ({ items }: { items: readonly ToolItem[] }) => (
  <ul className="divide-y divide-line-subtle overflow-hidden rounded-md border border-line">
    {items.map((item) => (
      <ToolRow key={item.key} item={item} />
    ))}
  </ul>
);
