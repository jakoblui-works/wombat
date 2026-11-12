import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Markdown } from "../Markdown/Markdown.tsx";

/** The agent's reasoning: collapsed to one line; expanded, its text (agent text, as Markdown). */
export const Reasoning = ({ text }: { text: string }) => {
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="focus-ring -ml-1 flex h-6 w-fit items-center gap-2 rounded-md px-1 text-sm text-fg-tertiary transition-colors hover:text-fg-secondary"
      >
        <Chevron className="size-3.5" />
        <Brain className="size-3.5" />
        Reasoning
      </button>
      {expanded ? <Markdown text={text} className="ml-1.5 border-l border-line pl-3 text-sm text-fg-secondary" /> : null}
    </div>
  );
};
