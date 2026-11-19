import type { ItemSummary } from "@wombat/shared/items";
import { TriangleAlert } from "lucide-react";
import { cloneElement, type ReactElement, type ReactNode, useId } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { lastPathPart } from "../../../../lib/path.ts";
import { cn } from "../../../../lib/utils";
import { itemName } from "../../Item/item-params.ts";
import { ProblemList } from "../ProblemList/ProblemList.tsx";

type Props = {
  item: ItemSummary;
  /** The row's element, without children: a button, or a treeitem with its own props. */
  render: ReactElement<Record<string, unknown>>;
  /** Shown before the handle (a tree row's chevron). */
  lead?: ReactNode;
  /** The title on as many lines as it needs (a board's card), not cut to one. */
  wrap?: boolean;
  /** The title struck through (a delete is proposed). */
  struck?: boolean;
};

const HANDLE = "w-14 shrink-0 truncate font-mono text-xs text-fg-tertiary";
const titleClass = (wrap: boolean, struck = false) => cn("min-w-0 flex-1 text-fg-primary", wrap ? "break-words" : "truncate", struck && "text-fg-secondary line-through");

/** One item in a view: its handle and title, and an invalid one's mark, its problems on hover or focus. */
export const ItemRow = ({ item, render, lead, wrap = false, struck = false }: Props) => {
  const described = useId();
  const invalid = item.problems.length > 0;
  return (
    <>
      <Tooltip disabled={!invalid}>
        <TooltipTrigger delay={200} render={render} aria-describedby={invalid ? described : undefined}>
          {lead}
          <span className={HANDLE}>{item.handle}</span> <span className={titleClass(wrap, struck)}>{itemName(item)}</span>
          {invalid ? <TriangleAlert role="img" aria-label="Invalid" className="size-3.5 shrink-0 text-danger" /> : null}
        </TooltipTrigger>
        {invalid ? (
          <TooltipContent className="max-w-80">
            <ProblemList problems={item.problems} file={lastPathPart(item.path)} />
          </TooltipContent>
        ) : null}
      </Tooltip>
      {invalid ? (
        <div hidden>
          <ProblemList problems={item.problems} file={lastPathPart(item.path)} id={described} />
        </div>
      ) : null}
    </>
  );
};

/** A proposed create's title when its fields hold none. */
const UNTITLED = "Untitled item";

/** A proposed create in a view: no handle yet, the title it proposes. */
export const PendingItemRow = ({ title, render, lead, wrap = false }: Omit<Props, "item" | "struck"> & { title: string | undefined }) =>
  cloneElement(
    render,
    {},
    <>
      {lead}
      <span className={cn(HANDLE, "italic")}>new</span> <span className={titleClass(wrap)}>{title ?? UNTITLED}</span>
    </>,
  );
