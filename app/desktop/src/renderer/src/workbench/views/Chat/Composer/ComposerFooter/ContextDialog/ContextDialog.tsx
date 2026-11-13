import type { ContextBreakdown } from "@wombat/shared/api";
import type { ReactNode } from "react";

import { cn } from "../../../../../../lib/utils";
import { contextShare } from "../ContextRing/ContextRing.tsx";
import type { ContextDialogProps } from "../slots.ts";

type Category = ContextBreakdown["categories"][number];

/** "565.3k", "1.0M": a token count short enough for a headline. */
export const compactTokens = (tokens: number): string =>
  tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1_000 ? `${(tokens / 1_000).toFixed(1)}k` : String(tokens);

/** A share of the window with one decimal ("0.3%"), "<0.1%" for a used but tiny share. */
export const shareLabel = (tokens: number, size: number): string => {
  const percent = contextShare({ used: tokens, size }) * 100;
  return percent > 0 && percent < 0.05 ? "<0.1%" : `${percent.toFixed(1)}%`;
};

/** The categories the table lists: `deferred` left out (not in the window), `free` last. */
export const tableCategories = (categories: readonly Category[]): Category[] => [
  ...categories.filter(({ kind }) => kind !== "deferred" && kind !== "free"),
  ...categories.filter(({ kind }) => kind === "free"),
];

/** The categories the bar stacks: what fills the window (`used`) and what is held back (`buffer`). */
export const barCategories = (categories: readonly Category[]): Category[] =>
  categories.filter(({ kind }) => kind === "used" || kind === "buffer");

const SWATCH: Record<Category["kind"], string> = {
  used: "bg-brand",
  buffer: "bg-fg-tertiary/60",
  free: "bg-surface-3",
  deferred: "bg-surface-3",
};

/** A category's swatch by its kind: the default `swatchOf`. */
export const defaultSwatch = ({ kind }: Pick<Category, "kind">): string => SWATCH[kind];

const SMALL_CAPS = "text-xs font-medium uppercase tracking-wider text-fg-tertiary";

export type ContextDialogLayoutProps = ContextDialogProps & {
  /** The colour class of a category's swatch, in the bar and the table (free space included); default by kind. */
  swatchOf?: (category: Category) => string;
  /** Something beside a list's title, by the list's id. */
  listAside?: (listId: string) => ReactNode;
};

/** The default `contextDialog` body, and the one owner of the layout: the model, the tokens, a bar and table of the categories, then the lists. */
export const ContextDialog = ({ breakdown, error, swatchOf = defaultSwatch, listAside }: ContextDialogLayoutProps) => {
  if (error !== undefined) return <p className="text-sm text-danger">{error}</p>;
  if (breakdown === undefined) return <p className="text-sm text-fg-secondary">Loading…</p>;
  const { model, used, size, categories, lists } = breakdown;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1.5">
        <span className="text-fg-secondary">{model}</span>
        <span className="text-fg-primary tabular-nums">
          {compactTokens(used)} / {compactTokens(size)} tokens ({shareLabel(used, size)})
        </span>
        <div data-slot="context-bar" className="flex h-2 w-full overflow-hidden rounded-full bg-surface-3">
          {barCategories(categories).map((category, index) => (
            <div
              key={`${category.name}:${String(index)}`}
              data-slot="context-bar-segment"
              className={cn("h-full", swatchOf(category))}
              style={{ width: `${contextShare({ used: category.tokens, size }) * 100}%` }}
            />
          ))}
        </div>
      </div>
      <table className="w-full tabular-nums">
        <caption className="sr-only">Usage by category</caption>
        <thead>
          <tr className={cn(SMALL_CAPS, "border-b border-border")}>
            <th scope="col" className="py-1.5 pl-5 pr-2 text-left font-medium">Category</th>
            <th scope="col" className="py-1.5 text-right font-medium">Tokens</th>
            <th scope="col" className="w-16 py-1.5 text-right font-medium">Usage</th>
          </tr>
        </thead>
        <tbody>
          {tableCategories(categories).map((category, index) => (
            <tr key={`${category.name}:${String(index)}`}>
              <td className="py-1 pr-2">
                <span className="flex items-center gap-3">
                  <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-[3px]", swatchOf(category))} />
                  {category.name}
                </span>
              </td>
              <td className="py-1 text-right text-fg-secondary">{compactTokens(category.tokens)}</td>
              <td className="w-16 py-1 text-right text-fg-tertiary">{shareLabel(category.tokens, size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lists.map(({ id, title, rows }) => (
        <section key={id} className="flex flex-col gap-1">
          <h3 className={cn(SMALL_CAPS, "flex items-baseline gap-2")}>
            {title}
            {listAside?.(id)}
          </h3>
          <ul className="flex flex-col pl-2">
            {rows.map(({ name, detail, tokens }, index) => (
              <li key={`${name}:${String(index)}`} className="flex items-baseline gap-2 py-0.5">
                <span className="min-w-0 truncate">{name}</span>
                {detail === undefined ? null : <span className="shrink-0 text-fg-tertiary">{detail}</span>}
                <span className="ml-auto shrink-0 text-fg-secondary tabular-nums">{compactTokens(tokens)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};
