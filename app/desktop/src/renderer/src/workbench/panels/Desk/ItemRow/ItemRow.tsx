import { TriangleAlert } from "lucide-react";
import { type AriaAttributes, cloneElement, type ReactElement, type ReactNode, useId } from "react";

import { InlineMarkdown } from "../../../../components/Markdown/Markdown.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { lastPathPart } from "../../../../lib/path.ts";
import { cn } from "../../../../lib/utils";
import { proposedTitle } from "../../../proposals/proposal-label.ts";
import { itemName } from "../../Item/item-params.ts";
import { ProblemList } from "../ProblemList/ProblemList.tsx";
import { FIRST_LINE, FIRST_LINE_BOX } from "../tree-keys.ts";
import { NOTHING_SHOWN, type RowContent, type Shown, shownContent } from "../view-model/row-content.ts";
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
  /** An item's excerpt and values, shown under its title or in its place (`rowContent`). */
  content?: RowContent | undefined;
};

/** A proposed create's title when its fields hold none. */
const UNTITLED = "Untitled item";

const TITLE_LINE = "block min-w-0 flex-1 truncate text-fg-primary";
const TITLE_WRAPS = "min-w-0 break-words text-fg-primary";
const MARK = cn("text-xs text-fg-tertiary italic", FIRST_LINE);

type Ids = { title: string; mark: string; problems: string; excerpt: string; values: string };

const describedBy = (...ids: (string | false)[]): string | undefined => {
  const named = ids.filter((id) => id !== false);
  return named.length === 0 ? undefined : named.join(" ");
};

// Children are spread, not passed as one argument: an explicit undefined child would empty a tooltip trigger's element.
const rooted = (render: Render, aria: AriaAttributes, ...children: ReactNode[]) => cloneElement(render, aria, ...children);

/** The title as the row's form draws it: on one line, or wrapped in full above the content (`ItemRow`'s `wraps`). */
const Titled = ({ title, wraps, shown, ids }: { title: ReactElement; wraps: boolean; shown: Shown; ids: Ids }) => {
  if (!wraps) return title;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      {title}
      {shown.excerpt === undefined ? null : <InlineMarkdown id={ids.excerpt} text={shown.excerpt} className="line-clamp-2 text-sm text-fg-secondary" />}
      {shown.values === undefined ? null : (
        <span id={ids.values} className="truncate text-xs text-fg-tertiary">
          {shown.values}
        </span>
      )}
    </div>
  );
};

const ItemLine = ({ row, render, lead, wraps = false, content, ids }: Props & { row: Extract<Row, { item: unknown }>; ids: Ids }) => {
  const { item } = row;
  const invalid = item.problems.length > 0;
  const titleClass = cn(wraps ? TITLE_WRAPS : TITLE_LINE, struck(row) && "text-fg-secondary line-through");
  const shown = shownContent(wraps, content);
  const aria = {
    "aria-labelledby": ids.title,
    "aria-describedby": describedBy(shown.excerpt !== undefined && ids.excerpt, shown.values !== undefined && ids.values, invalid && ids.problems),
  };
  const text = shown.line ?? item.title;
  const title =
    text === null ? (
      <span id={ids.title} className={titleClass}>
        {itemName(item)}
      </span>
    ) : (
      <InlineMarkdown id={ids.title} text={text} className={titleClass} />
    );
  const children = [
    lead,
    <Titled key="title" title={title} wraps={wraps} shown={shown} ids={ids} />,
    invalid ? (
      <span key="invalid" className={FIRST_LINE_BOX}>
        <TriangleAlert role="img" aria-label="Invalid" className="size-3.5 text-danger" />
      </span>
    ) : null,
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
 * One row of a view: an item's title (struck for a proposed delete, marked when invalid with its problems on hover or
 * focus) and, in a rich row, its excerpt and values, the excerpt in the title's place when it repeats the title; a
 * proposed create's title marked "new"; or a missing item's handle marked `MISSING_ITEM`. On one line, or growing with
 * the title wrapped (`wraps`).
 */
export const ItemRow = (props: Props) => {
  const { row, render, lead, wraps = false } = props;
  const id = useId();
  const ids: Ids = { title: `${id}-title`, mark: `${id}-mark`, problems: `${id}-problems`, excerpt: `${id}-excerpt`, values: `${id}-values` };
  if (isItemRow(row)) return <ItemLine {...props} row={row} ids={ids} />;
  if (isPending(row)) {
    const title = <InlineMarkdown id={ids.title} text={proposedTitle(row.fields) ?? UNTITLED} className={wraps ? TITLE_WRAPS : TITLE_LINE} />;
    return rooted(
      render,
      { "aria-labelledby": ids.title, "aria-describedby": ids.mark },
      lead,
      <Titled key="title" title={title} wraps={wraps} shown={NOTHING_SHOWN} ids={ids} />,
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
