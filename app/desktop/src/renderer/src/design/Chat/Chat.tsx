import { Brain, Check, ChevronRight, Terminal } from "lucide-react";
import type { ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Code } from "@/lib/highlight";
import { AGENT_CODE, REASONING_SUMMARY, SHELL_PERMISSION, USER_MESSAGE } from "../fixtures.ts";
import { Composer } from "./Composer.tsx";
import { EditApproval } from "./EditApproval.tsx";
import { Plan } from "./Plan.tsx";
import { ToolCalls } from "./ToolCalls.tsx";

const InlineCode = ({ children }: { children: ReactNode }) => (
  <code className="rounded-xs bg-surface-3 px-1 py-px font-mono text-sm text-fg-primary">{children}</code>
);

const UserMessage = () => (
  <div className="flex justify-end">
    <p className="max-w-3/4 rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-base text-fg-primary">{USER_MESSAGE}</p>
  </div>
);

const Reasoning = () => (
  <button type="button" aria-expanded={false} className="focus-ring -ml-1 flex h-6 items-center gap-2 rounded-md px-1 text-sm text-fg-tertiary transition-colors hover:text-fg-secondary">
    <ChevronRight className="size-3.5" />
    <Brain className="size-3.5" />
    {REASONING_SUMMARY}
  </button>
);

/** A shell command's permission request, already answered: what was asked and what I chose, nothing left to press. */
const AnsweredPermission = () => (
  <div className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm">
    <Terminal className="size-3.5 shrink-0 text-fg-secondary" />
    <span className="shrink-0 text-fg-secondary">Run</span>
    <code className="min-w-0 truncate font-mono text-xs text-fg-primary">{SHELL_PERMISSION.command}</code>
    <span className="ml-auto flex shrink-0 items-center gap-1 rounded-sm bg-surface-3 px-1.5 py-0.5 text-xs text-fg-secondary">
      <Check className="size-3" />
      {SHELL_PERMISSION.answer}
    </span>
  </div>
);

const AgentMessage = () => (
  <div className="flex flex-col gap-2 text-base text-fg-primary">
    <Reasoning />
    <ToolCalls expanded="t2" />
    <p>
      Found it. The total loses a cent because <InlineCode>totals.ts</InlineCode> rounds twice:
    </p>
    <ul className="flex list-disc flex-col pl-5 marker:text-fg-tertiary">
      <li>
        <InlineCode>lineTotal</InlineCode> rounds every discounted line,
      </li>
      <li>
        then <InlineCode>sumLineItems</InlineCode> adds up the rounded lines.
      </li>
    </ul>
    <div className="code-block overflow-hidden rounded-md border border-line-subtle bg-surface-0">
      <Code code={AGENT_CODE} lang="typescript" />
    </div>
    <AnsweredPermission />
    <EditApproval />
  </div>
);

/** An agent's chat: the plan pinned on top, the conversation, the message box at the bottom. */
export const Chat = () => (
  <div className="flex h-full min-h-0 flex-col">
    <Plan />
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex max-w-chat flex-col gap-3 px-5 pt-2 pb-4">
        <UserMessage />
        <AgentMessage />
      </div>
    </ScrollArea>
    <Composer />
  </div>
);
