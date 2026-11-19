import type { ItemSummary } from "@wombat/shared/items";
import { TriangleAlert } from "lucide-react";
import { type ReactElement, type ReactNode, useId } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { lastPathPart } from "../../../../lib/path.ts";
import { problemLocation } from "../desk-tree.ts";

type Props = {
  item: ItemSummary;
  /** The row's element, without children: a button, or a treeitem with its own props. */
  render: ReactElement<Record<string, unknown>>;
  /** Shown before the handle (a tree row's chevron). */
  lead?: ReactNode;
};

const Problems = ({ item, id }: { item: ItemSummary; id?: string }) => (
  <span id={id} className="flex flex-col gap-1">
    {item.problems.map((problem, index) => {
      const location = problemLocation(problem, lastPathPart(item.path));
      return (
        <span key={index} className="flex flex-col">
          <span>{problem.message}</span>
          {location === undefined ? null : <span className="text-xs text-fg-tertiary">{location}</span>}
        </span>
      );
    })}
  </span>
);

/** One item in a view: its handle and title, and an invalid one's mark, its problems on hover or focus. */
export const ItemRow = ({ item, render, lead }: Props) => {
  const described = useId();
  const invalid = item.problems.length > 0;
  return (
    <>
      <Tooltip disabled={!invalid}>
        <TooltipTrigger delay={200} render={render} aria-describedby={invalid ? described : undefined}>
          {lead}
          <span className="w-14 shrink-0 truncate font-mono text-xs text-fg-tertiary">{item.handle}</span>{" "}
          <span className="min-w-0 flex-1 truncate text-fg-primary">{item.title ?? lastPathPart(item.path)}</span>
          {invalid ? <TriangleAlert role="img" aria-label="Invalid" className="size-3.5 shrink-0 text-danger" /> : null}
        </TooltipTrigger>
        {invalid ? (
          <TooltipContent className="max-w-80">
            <Problems item={item} />
          </TooltipContent>
        ) : null}
      </Tooltip>
      {invalid ? (
        <span hidden>
          <Problems item={item} id={described} />
        </span>
      ) : null}
    </>
  );
};
