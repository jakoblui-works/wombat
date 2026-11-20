import { TriangleAlert } from "lucide-react";
import { type AriaAttributes, cloneElement, type ReactElement, type ReactNode, useId } from "react";

import { InlineMarkdown } from "../../../../components/Markdown/Markdown.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { lastPathPart } from "../../../../lib/path.ts";
import { cn } from "../../../../lib/utils";
import { proposedTitle } from "../../../proposals/proposal-label.ts";
import { itemName } from "../../Item/item-params.ts";
import { ProblemList } from "../ProblemList/ProblemList.tsx";
import { MISSING_ITEM } from "../view-model/values.ts";
import { isItemRow, isPending, type Row } from "../view-model/view-model.ts";
import { struck } from "../view-model/with-proposals.ts";

type Render = ReactElement<Pick<AriaAttributes, "aria-labelledby" | "aria-describedby">>;

type Props = {
  row: Row;
  /** The row's root element, without children: a treeitem laid out as one line (`ItemTree`). */
  render: Render;
  /** Shown before the title (a chevron). */
  lead?: ReactNode;
};

/** A proposed create's title when its fields hold none. */
const UNTITLED = "Untitled item";

const TITLE = "block min-w-0 flex-1 truncate text-fg-primary";
const MARK = "text-xs text-fg-tertiary italic";

type Ids = { title: string; mark: string; problems: string };

// Children are spread, not passed as one argument: an explicit undefined child would empty a tooltip trigger's element.
const rooted = (render: Render, aria: AriaAttributes, ...children: ReactNode[]) => cloneElement(render, aria, ...children);

const ItemLine = ({ row, render, lead, ids }: Props & { row: Extract<Row, { item: unknown }>; ids: Ids }) => {
  const { item } = row;
  const invalid = item.problems.length > 0;
  const titleClass = cn(TITLE, struck(row) && "text-fg-secondary line-through");
  const aria = { "aria-labelledby": ids.title, "aria-describedby": invalid ? ids.problems : undefined };
  const children = [
    lead,
    item.title === null ? (
      <span key="title" id={ids.title} className={titleClass}>
        {itemName(item)}
      </span>
    ) : (
      <InlineMarkdown key="title" id={ids.title} text={item.title} className={titleClass} />
    ),
    invalid ? <TriangleAlert key="invalid" role="img" aria-label="Invalid" className="size-3.5 shrink-0 text-danger" /> : null,
  ];
  if (!invalid) return rooted(render, aria, ...children);
  const file = lastPathPart(item.path);
  return (
    <>
      <Tooltip>
        <TooltipTrigger delay={200} render={rooted(render, {})} {...aria}>
          {children}
        </TooltipTrigger>
        <TooltipContent className="max-w-80">
          <ProblemList problems={item.problems} file={file} />
        </TooltipContent>
      </Tooltip>
      <div hidden>
        <ProblemList problems={item.problems} file={file} id={ids.problems} />
      </div>
    </>
  );
};

/**
 * One row of a view on one line: an item's title (struck for a proposed delete, marked when invalid with its problems
 * on hover or focus), a proposed create's title marked "new", or a missing item's handle marked `MISSING_ITEM`.
 */
export const ItemRow = (props: Props) => {
  const { row, render, lead } = props;
  const id = useId();
  const ids: Ids = { title: `${id}-title`, mark: `${id}-mark`, problems: `${id}-problems` };
  if (isItemRow(row)) return <ItemLine {...props} row={row} ids={ids} />;
  if (isPending(row)) {
    return rooted(
      render,
      { "aria-labelledby": ids.title, "aria-describedby": ids.mark },
      lead,
      <InlineMarkdown key="title" id={ids.title} text={proposedTitle(row.fields) ?? UNTITLED} className={TITLE} />,
      <span key="mark" id={ids.mark} className={cn(MARK, "shrink-0")}>
        new
      </span>,
    );
  }
  return rooted(
    render,
    { "aria-labelledby": `${ids.title} ${ids.mark}` },
    lead,
    <span key="title" id={ids.title} className="min-w-0 truncate font-mono text-sm text-fg-secondary">
      {row.missing}
    </span>,
    <span key="mark" id={ids.mark} className={cn(MARK, "min-w-0 flex-1 truncate")}>
      {MISSING_ITEM}
    </span>,
  );
};
