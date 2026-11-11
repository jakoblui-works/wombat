import { Columns2, FilePen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AGENT_STATES } from "@/lib/agent-state";
import { cn } from "@/lib/utils";
import { type DiffLine, EDIT } from "../fixtures.ts";

const LINE_LOOK = {
  context: { marker: " ", row: "", markerColour: "text-fg-secondary", label: undefined },
  removed: { marker: "−", row: "bg-danger-subtle", markerColour: "text-danger", label: "removed" },
  added: { marker: "+", row: "bg-success-subtle", markerColour: "text-success", label: "added" },
} as const;

const DiffRow = ({ line }: { line: DiffLine }) => {
  const look = LINE_LOOK[line.kind];
  return (
    <div className={cn("flex w-max min-w-full", look.row)} aria-label={look.label}>
      <span className="w-9 shrink-0 pr-2 text-right text-fg-secondary select-none tabular-nums">{line.old ?? ""}</span>
      <span className="w-9 shrink-0 pr-2 text-right text-fg-secondary select-none tabular-nums">{line.new ?? ""}</span>
      <span className={cn("w-5 shrink-0 text-center select-none", look.markerColour)}>{look.marker}</span>
      <span className="pr-4 whitespace-pre text-fg-primary">{line.text}</span>
    </div>
  );
};

/** A permission request for a file edit: its diff, compact, with the answer buttons. */
export const EditApproval = () => {
  const waiting = AGENT_STATES.waiting;
  return (
    <section aria-label="Edit approval" className="overflow-hidden rounded-lg border border-line-strong bg-surface-2">
      <header className="flex h-8 items-center gap-2 border-b border-line pr-1.5 pl-3">
        <FilePen className="size-3.5 shrink-0 text-fg-secondary" />
        <span className="shrink-0 text-sm font-medium text-fg-primary">Edit</span>
        <code className="min-w-0 truncate font-mono text-xs text-fg-secondary">{EDIT.file}</code>
        <span className="shrink-0 font-mono text-xs tabular-nums">
          <span className="text-success">+{EDIT.added}</span> <span className="text-danger">−{EDIT.removed}</span>
        </span>
        <Button variant="secondary" size="sm" className="ml-auto">
          <Columns2 />
          Open side by side
        </Button>
      </header>
      <div className="overflow-x-auto bg-surface-0 py-1 font-mono text-xs leading-4">
        {EDIT.lines.map((line, index) => (
          <DiffRow key={index} line={line} />
        ))}
      </div>
      <footer className="flex items-center gap-2 border-t border-line py-1.5 pr-1.5 pl-3">
        <waiting.icon className={cn("size-3.5 shrink-0", waiting.colour)} />
        <span className="min-w-0 truncate text-sm text-fg-secondary">The agent waits for your answer</span>
        <div className="ml-auto flex shrink-0 gap-2">
          <Button variant="secondary" size="sm">
            Reject
          </Button>
          <Button size="sm">
            Approve
          </Button>
        </div>
      </footer>
    </section>
  );
};
