import type { LenientView } from "@wombat/shared/items";
import { TriangleAlert } from "lucide-react";
import { type AriaAttributes, cloneElement, Fragment, type ReactElement, type ReactNode, useId } from "react";

import { InlineMarkdown } from "../../../../components/Markdown/Markdown.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { lastPathPart } from "../../../../lib/path.ts";
import { cn } from "../../../../lib/utils";
import { proposedTitle } from "../../../proposals/proposal-label.ts";
import { itemName } from "../../Item/item-params.ts";
import { ProblemList } from "../ProblemList/ProblemList.tsx";
import { type CardContent, cardContent } from "../view-model/card-content.ts";
import { MISSING_ITEM } from "../view-model/values.ts";
import { isItemRow, isPending, type Properties, type Row } from "../view-model/view-model.ts";
import { struck } from "../view-model/with-proposals.ts";

type Props = {
  row: Row;
  view: LenientView;
  properties: Properties;
  /** The card's root element, without children: a button, or a treeitem with its own props. */
  render: ReactElement<{ className?: string } & Pick<AriaAttributes, "aria-labelledby" | "aria-describedby">>;
  /** Shown before the card's text (a tree row's chevron). */
  lead?: ReactNode;
};

/** A proposed create's title when its fields hold none. */
const UNTITLED = "Untitled item";

const ROOT = "flex items-start gap-1.5";
const TITLE = "line-clamp-3 text-base text-fg-primary";
/** The title's weight: a tree's compact rows keep it regular, a card's title is the one thing that stands out. */
const titleWeight = (view: LenientView): string => (view.kind === "tree" ? "font-normal" : "font-semibold");

/** The ids of a card's parts: its name is the title and the handle (or mark), its description the rest. */
type CardIds = { title: string; mark: string; excerpt: string; chips: string; problems: string };

const cardIds = (id: string): CardIds => ({ title: `${id}-title`, mark: `${id}-mark`, excerpt: `${id}-excerpt`, chips: `${id}-chips`, problems: `${id}-problems` });

/** The card's name and description by its parts' ids; a part it doesn't show isn't named. */
const cardAria = (ids: CardIds, shows: { excerpt: boolean; chips: boolean; problems: boolean }) => {
  const described = [shows.excerpt && ids.excerpt, shows.chips && ids.chips, shows.problems && ids.problems].filter((part) => part !== false);
  return { "aria-labelledby": `${ids.title} ${ids.mark}`, "aria-describedby": described.length === 0 ? undefined : described.join(" ") };
};

// Children are spread, not passed as one argument: an explicit undefined child would empty a tooltip trigger's element.
const rooted = (render: Props["render"], aria: AriaAttributes, ...children: ReactNode[]) => cloneElement(render, { ...aria, className: cn(ROOT, render.props.className) }, ...children);

/** Values longer than this give way first on a full meta line; shorter ones end in an ellipsis only once those are gone. */
const SHORT_VALUE = 12;
const givesWay = (text: string): boolean => text.length > SHORT_VALUE;

/** The quiet line under a card's text: the handle (or another mark), then the chips' values, joined by " · ". */
const MetaLine = ({ ids, mark, markClass, chips }: { ids: CardIds; mark: ReactNode; markClass: string | undefined; chips: CardContent["chips"] }) => (
  <span className="flex min-w-0 items-baseline overflow-hidden text-xs text-fg-tertiary">
    <span id={ids.mark} className={cn("shrink-0 font-mono", markClass)}>
      {mark}
    </span>
    <span id={ids.chips} className="contents">
      {chips.map(({ name, text }) => (
        <Fragment key={name}>
          <span aria-hidden className="shrink-0 px-1.5">
            ·
          </span>
          <span title={`${name}: ${text}`} className={cn("min-w-0 truncate", givesWay(text) && "shrink-[10000]")}>
            <span className="sr-only">{name}: </span>
            {text}
          </span>
        </Fragment>
      ))}
    </span>
  </span>
);

type BodyProps = { ids: CardIds; title: ReactNode; excerpt?: string | undefined; mark: ReactNode; markClass?: string; chips?: CardContent["chips"]; lead: ReactNode };

/** A card's text: the title, the excerpt, then the meta line. */
const Body = ({ ids, title, excerpt, mark, markClass, chips = [], lead }: BodyProps) => (
  <>
    {lead}
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      {title}
      {excerpt === undefined ? null : <InlineMarkdown id={ids.excerpt} text={excerpt} className="line-clamp-2 text-sm text-fg-secondary" />}
      <MetaLine ids={ids} mark={mark} markClass={markClass} chips={chips} />
    </span>
  </>
);

/** One item in a view, as a card: its title, the start of its body, its handle and chips; an invalid one's mark, its problems on hover or focus. */
const ItemRowCard = ({ row, view, properties, render, lead, ids }: Props & { row: Extract<Row, { item: unknown }>; ids: CardIds }) => {
  const { item } = row;
  const invalid = item.problems.length > 0;
  const content = cardContent(item, view, properties);
  const { excerpt } = content;
  const titleClass = cn(TITLE, titleWeight(view), "flex-1", struck(row) && "text-fg-secondary line-through");
  const title = (
    <span className="flex min-w-0 items-start gap-1.5">
      {item.title === null ? (
        <span id={ids.title} className={cn(titleClass, "min-w-0 break-words")}>
          {itemName(item)}
        </span>
      ) : (
        <InlineMarkdown id={ids.title} text={item.title} className={titleClass} />
      )}
      {invalid ? <TriangleAlert role="img" aria-label="Invalid" className="mt-0.75 size-3.5 shrink-0 text-danger" /> : null}
    </span>
  );
  const aria = cardAria(ids, { excerpt: excerpt !== undefined, chips: content.chips.length > 0, problems: invalid });
  const body = <Body ids={ids} title={title} excerpt={excerpt} mark={item.handle} chips={content.chips} lead={lead} />;
  if (!invalid) return rooted(render, aria, body);
  return (
    <>
      <Tooltip>
        <TooltipTrigger delay={200} render={rooted(render, {})} {...aria}>
          {body}
        </TooltipTrigger>
        <TooltipContent className="max-w-80">
          <ProblemList problems={item.problems} file={lastPathPart(item.path)} />
        </TooltipContent>
      </Tooltip>
      <div hidden>
        <ProblemList problems={item.problems} file={lastPathPart(item.path)} id={ids.problems} />
      </div>
    </>
  );
};

/** A row of a view by its kind, as a card: an item, a proposed create (its title, marked new) or a missing item (its handle, `MISSING_ITEM`). */
export const ItemCard = (props: Props) => {
  const { row, view, render, lead } = props;
  const ids = cardIds(useId());
  if (isItemRow(row)) return <ItemRowCard {...props} row={row} ids={ids} />;
  const aria = cardAria(ids, { excerpt: false, chips: false, problems: false });
  if (isPending(row)) {
    const title = <InlineMarkdown id={ids.title} text={proposedTitle(row.fields) ?? UNTITLED} className={cn(TITLE, titleWeight(view))} />;
    return rooted(render, aria, <Body ids={ids} title={title} mark="new" markClass="italic" lead={lead} />);
  }
  const title = (
    <span id={ids.title} className={cn(TITLE, titleWeight(view), "text-fg-tertiary italic")}>
      {MISSING_ITEM}
    </span>
  );
  return rooted(render, aria, <Body ids={ids} title={title} mark={row.missing} lead={lead} />);
};
