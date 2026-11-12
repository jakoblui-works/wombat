import { useRef } from "react";

import { cn } from "../../../../lib/utils";
import type { EditDiff as EditDiffData } from "../edit-request.ts";
import { type InlineDiff, type InlineRow, inlineDiff } from "./inline-diff.ts";

const sameTexts = (a: readonly EditDiffData[], b: readonly EditDiffData[]): boolean =>
  a.length === b.length && a.every((diff, index) => diff.oldText === b[index]?.oldText && diff.newText === b[index]?.newText);

/**
 * An edit's inline diff, worked out again only when its texts change: chatModel builds new arrays on every append, but
 * the texts are the log's own strings, so comparing them is cheap.
 */
export const useInlineDiff = (diffs: readonly EditDiffData[]): InlineDiff => {
  const last = useRef<{ diffs: readonly EditDiffData[]; diff: InlineDiff }>(undefined);
  if (last.current === undefined || !sameTexts(last.current.diffs, diffs)) last.current = { diffs, diff: inlineDiff(diffs) };
  return last.current.diff;
};

// No line numbers: an edit's diff may be a snippet of the file (Claude's Edit), so numbers counted from 1 would mislead.
const LINE_LOOK = {
  context: { marker: " ", row: "", markerColour: "text-fg-secondary", said: undefined },
  removed: { marker: "−", row: "bg-danger-subtle", markerColour: "text-danger", said: "removed" },
  added: { marker: "+", row: "bg-success-subtle", markerColour: "text-success", said: "added" },
} as const;

const Row = ({ row }: { row: InlineRow }) => {
  if (row.kind === "gap") {
    return (
      <div className="flex w-max min-w-full text-fg-tertiary select-none">
        <span className="w-5 shrink-0 text-center">⋯</span>
        <span className="pr-4">
          {row.count} unchanged {row.count === 1 ? "line" : "lines"}
        </span>
      </div>
    );
  }
  const look = LINE_LOOK[row.kind];
  return (
    <div className={cn("flex min-h-4 w-max min-w-full", look.row)}>
      <span className={cn("w-5 shrink-0 text-center select-none", look.markerColour)}>
        <span aria-hidden>{look.marker}</span>
        {look.said === undefined ? null : <span className="sr-only">{look.said}</span>}
      </span>
      <span className="pr-4 whitespace-pre text-fg-primary">{row.text}</span>
    </div>
  );
};

/** The edit's lines added and removed, all its diffs together, as the card's header shows them. */
export const DiffCounts = ({ diff }: { diff: Extract<InlineDiff, { kind: "shown" }> }) => (
  <span className="shrink-0 font-mono text-xs tabular-nums">
    <span className="text-success">+{diff.added}</span> <span className="text-danger">−{diff.removed}</span>
  </span>
);

/** Said where an answered edit's diffs were, once the agent replaced them (the request stays an edit). */
export const CHANGE_GONE = "The change is no longer in the agent's log.";

/** Said where an open edit request's diffs would be when it carries none: nothing was taken away, there was none. */
export const NO_CHANGE = "This request shows no change.";

const Message = ({ children }: { children: string }) => <p className="bg-surface-0 px-3 py-2 text-sm text-fg-secondary">{children}</p>;

/**
 * An edit's changed lines with their context, each diff in turn; too large, a line saying so (the diff tab shows it).
 * No diffs at all is an open request that carries none (an answered one doesn't show its diff here): NO_CHANGE.
 */
export const DiffRows = ({ diff }: { diff: InlineDiff }) => {
  if (diff.kind === "too-large") return <Message>This change is too large to show here. Open it side by side to review it.</Message>;
  if (diff.parts.length === 0) return <Message>{NO_CHANGE}</Message>;
  return (
    <div className="divide-y divide-line-subtle bg-surface-0 font-mono text-xs leading-4">
      {diff.parts.map((rows, part) => (
        <div key={part} className="overflow-x-auto py-1">
          {rows.length === 0 ? <p className="px-3 font-sans text-sm text-fg-secondary">No line changes.</p> : rows.map((row, index) => <Row key={index} row={row} />)}
        </div>
      ))}
    </div>
  );
};

/** A tool call's diff content, in its expanded row: the file and its inline diff. */
export const EditDiff = ({ path, oldText, newText }: { path: string } & EditDiffData) => {
  const diff = useInlineDiff([{ oldText, newText }]);
  return (
    <div className="overflow-hidden rounded-md border border-line-subtle">
      <div className="flex items-center gap-2 border-b border-line-subtle px-2.5 py-1">
        <code className="min-w-0 truncate font-mono text-xs text-fg-secondary">{path}</code>
        {diff.kind === "shown" ? <DiffCounts diff={diff} /> : null}
      </div>
      <DiffRows diff={diff} />
    </div>
  );
};
