import { TriangleAlert } from "lucide-react";
import { type AriaAttributes, cloneElement, type ReactElement, type ReactNode, useId } from "react";

import { InlineMarkdown } from "../../../../components/Markdown/Markdown.tsx";
import { lastPathPart } from "../../../../lib/path.ts";
import { cn } from "../../../../lib/utils";
import { proposedTitle } from "../../../proposals/proposal-label.ts";
import { itemName } from "../../Item/item-params.ts";
import { ProblemList } from "../ProblemList/ProblemList.tsx";
import { FIRST_LINE, FIRST_LINE_BOX } from "../tree-keys.ts";
import { type RowContent, shownContent } from "../view-model/row-content.ts";
import { MISSING_ITEM } from "../view-model/values.ts";
import { isItemRow, isPending, type Row } from "../view-model/view-model.ts";
import { struck } from "../view-model/with-proposals.ts";

type Render = ReactElement<Pick<AriaAttributes, "aria-labelledby" | "aria-describedby">>;

type Props = {
  row: Row;
  /** The row's root element, without children: a treeitem laid out as one line or growing (`ItemTree`). */
  render: Render;
  /** Shown before the title (a chevron). */
  lead?: ReactNode;
  /** The title wraps in full (a list's row); else it ends in an ellipsis when it doesn't fit (a tree's). */
  wraps?: boolean | undefined;
  /** An item's line, shown in its title's place (`rowContent`). */
  content?: RowContent | undefined;
};

/** A proposed create's title when its fields hold none. */
const UNTITLED = "Untitled item";

const TITLE_LINE = "block min-w-0 flex-1 truncate text-fg-primary";
const TITLE_WRAPS = "min-w-0 flex-1 break-words text-fg-primary";
const MARK = cn("text-xs text-fg-tertiary italic", FIRST_LINE);

type Ids = { title: string; mark: string; problems: string };

// Children are spread, not passed as one argument: an explicit undefined child would empty a preview trigger's element.
const rooted = (render: Render, aria: AriaAttributes, ...children: ReactNode[]) => cloneElement(render, aria, ...children);

const ItemLine = ({ row, render, lead, wraps = false, content, ids }: Props & { row: Extract<Row, { item: unknown }>; ids: Ids }) => {
  const { item } = row;
  const invalid = item.problems.length > 0;
  const titleClass = cn(wraps ? TITLE_WRAPS : TITLE_LINE, struck(row) && "text-fg-secondary line-through");
  const aria = { "aria-labelledby": ids.title, "aria-describedby": invalid ? ids.problems : undefined };
  const text = shownContent(wraps, content).line ?? item.title;
  const title =
    text === null ? (
      <span key="title" id={ids.title} className={titleClass}>
        {itemName(item)}
      </span>
    ) : (
      <InlineMarkdown key="title" id={ids.title} text={text} className={titleClass} />
    );
  const children = [
    lead,
    title,
    invalid ? (
      <span key="invalid" className={FIRST_LINE_BOX}>
        <TriangleAlert role="img" aria-label="Invalid" className="size-3.5 text-danger" />
      </span>
    ) : null,
  ];
  if (!invalid) return rooted(render, aria, ...children);
  return (
    <>
      {rooted(render, aria, ...children)}
      <div hidden>
        <ProblemList problems={item.problems} file={lastPathPart(item.path)} id={ids.problems} />
      </div>
    </>
  );
};

/**
 * One row of a view: an item's title (struck for a proposed delete, marked when invalid, its problems its description),
 * in a rich row its line in the title's place (`rowContent`); a proposed create's title marked "new"; or a
 * missing item's handle marked `MISSING_ITEM`. On one line, or growing with the title wrapped (`wraps`).
 */
export const ItemRow = (props: Props) => {
  const { row, render, lead, wraps = false } = props;
  const id = useId();
  const ids: Ids = { title: `${id}-title`, mark: `${id}-mark`, problems: `${id}-problems` };
  if (isItemRow(row)) return <ItemLine {...props} row={row} ids={ids} />;
  if (isPending(row)) {
    return rooted(
      render,
      { "aria-labelledby": ids.title, "aria-describedby": ids.mark },
      lead,
      <InlineMarkdown key="title" id={ids.title} text={proposedTitle(row.fields) ?? UNTITLED} className={wraps ? TITLE_WRAPS : TITLE_LINE} />,
      <span key="mark" id={ids.mark} className={cn(MARK, "shrink-0")}>
        new
      </span>,
    );
  }
  return rooted(
    render,
    { "aria-labelledby": `${ids.title} ${ids.mark}` },
    lead,
    <span key="title" id={ids.title} className={cn("min-w-0 truncate font-mono text-sm text-fg-secondary", FIRST_LINE)}>
      {row.missing}
    </span>,
    <span key="mark" id={ids.mark} className={cn(MARK, "min-w-0 flex-1 truncate")}>
      {MISSING_ITEM}
    </span>,
  );
};
