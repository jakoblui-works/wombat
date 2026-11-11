import { Check, ChevronDown, ChevronRight, FileText, Search, Terminal } from "lucide-react";

import { TOOL_CALLS, type ToolCall } from "../fixtures.ts";

const KIND_ICONS = { read: FileText, search: Search, execute: Terminal } as const;

const Detail = ({ label, text }: { label: string; text: string }) => (
  <div className="flex gap-3">
    <dt className="w-11 shrink-0 pt-1 text-xs font-medium text-fg-tertiary">{label}</dt>
    <dd className="min-w-0 flex-1">
      <pre className="overflow-x-auto rounded-md border border-line-subtle bg-surface-0 px-2.5 py-1 font-mono text-xs text-fg-secondary">{text}</pre>
    </dd>
  </div>
);

/** One tool call: a one-line row (tool, target, status); expanded, its input and output below. */
const ToolRow = ({ call, expanded }: { call: ToolCall; expanded: boolean }) => {
  const KindIcon = KIND_ICONS[call.kind];
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <li>
      <button type="button" aria-expanded={expanded} className="focus-ring flex h-7 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors hover:bg-surface-2">
        <Chevron className="size-3.5 shrink-0 text-fg-tertiary" />
        <KindIcon className="size-3.5 shrink-0 text-fg-secondary" />
        <span className="shrink-0 font-medium text-fg-secondary">{call.tool}</span>
        <code className="min-w-0 truncate font-mono text-xs text-fg-primary">{call.target}</code>
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-xs text-fg-tertiary">
          {call.detail}
          <Check aria-label="Done" className="size-3.5" />
        </span>
      </button>
      {expanded && call.input !== undefined && call.output !== undefined ? (
        <dl className="flex flex-col gap-1 border-t border-line-subtle px-2.5 pt-1.5 pb-2 pl-8">
          <Detail label="Input" text={call.input} />
          <Detail label="Output" text={call.output} />
        </dl>
      ) : null}
    </li>
  );
};

/** The turn's tool calls, collapsed to one line each; one is open. */
export const ToolCalls = ({ expanded }: { expanded: string }) => (
  <ul className="divide-y divide-line-subtle overflow-hidden rounded-md border border-line">
    {TOOL_CALLS.map((call) => (
      <ToolRow key={call.id} call={call} expanded={call.id === expanded} />
    ))}
  </ul>
);
