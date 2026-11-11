import { X } from "lucide-react";
import type { ReactNode } from "react";

import { AGENT_STATES } from "@/lib/agent-state";
import { cn } from "@/lib/utils";
import { agentById } from "../fixtures.ts";

/**
 * A tab strip of agent chats (each marked with its agent's state) above the active tab's content. A `wide` group takes
 * twice the share of the editor area.
 */
export const EditorGroup = ({ tabs, active, wide = false, children }: { tabs: readonly string[]; active?: string; wide?: boolean; children: ReactNode }) => (
  <section className={cn("flex min-w-0 flex-1 flex-col border-l border-line bg-surface-1 first:border-l-0", wide && "flex-2")}>
    <div role="tablist" className="flex h-tab-strip shrink-0 bg-surface-0">
      {tabs.map((id) => {
        const agent = agentById(id);
        const state = AGENT_STATES[agent.state];
        const selected = id === active;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={selected}
            className={cn(
              "flex min-w-0 max-w-64 items-center gap-2 border-r border-b border-r-line-subtle border-b-line pr-2 pl-3 text-sm text-fg-tertiary",
              selected && "border-b-transparent bg-surface-1 text-fg-primary",
            )}
          >
            <state.icon aria-label={state.label} className={cn("size-3.5 shrink-0", state.colour)} />
            <span className="truncate">{agent.title}</span>
            <X className={cn("size-3.5 shrink-0 text-fg-tertiary", !selected && "invisible")} />
          </div>
        );
      })}
      <div className="flex-1 border-b border-line" />
    </div>
    <div className="min-h-0 flex-1">{children}</div>
  </section>
);
