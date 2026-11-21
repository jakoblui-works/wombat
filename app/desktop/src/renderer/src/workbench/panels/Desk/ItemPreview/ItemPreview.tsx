import { useQuery } from "@tanstack/react-query";
import type { ItemSummary } from "@wombat/shared/items";
import type { ReactNode } from "react";

import { InlineMarkdown, Markdown } from "../../../../components/Markdown/Markdown.tsx";
import { Button } from "../../../../components/ui/button";
import { useBinders } from "../../../../data/hooks.ts";
import { itemQuery } from "../../../../data/query-client.ts";
import { lastPathPart } from "../../../../lib/path.ts";
import { cn } from "../../../../lib/utils";
import { itemName } from "../../Item/item-params.ts";
import { ProblemList } from "../ProblemList/ProblemList.tsx";
import { previewName, previewShown, propertyLines } from "./item-preview.ts";

/** How long the pointer rests on what has a preview before its box opens. */
export const PREVIEW_DELAY_MS = 400;
/** How long the box stays once the pointer has left both it and what opened it. */
export const PREVIEW_CLOSE_DELAY_MS = 200;

type Props = {
  /** An item's id or handle. */
  itemRef: string;
  /** The item as its binder lists it, when the preview is a row's: a listing without an id isn't read. */
  listed?: ItemSummary | undefined;
  onOpen: () => void;
};

const PART = "border-line-subtle px-3 py-2 not-first:border-t";

const Footer = ({ onOpen }: { onOpen: () => void }) => (
  <div className={cn(PART, "py-1")}>
    <Button variant="link" size="xs" className="-mx-2" onClick={onOpen}>
      Open
    </Button>
  </div>
);

const Note = ({ children }: { children: ReactNode }) => <p className={cn(PART, "text-fg-secondary")}>{children}</p>;

/** The whole of item `itemRef` without opening it: its title and handle, its properties, its body, and a way to open it. */
export const ItemPreview = ({ itemRef, listed, onOpen }: Props) => {
  // A box opens on every hover: a ref that names no item is read again on the next items alert, not on each open.
  const read = useQuery({ ...itemQuery(itemRef), retryOnMount: false, enabled: listed?.id !== null });
  const binders = useBinders();
  const shown = previewShown(read, listed);

  switch (shown.kind) {
    case "loading":
      return <Note>Loading…</Note>;
    case "not-found":
      return <Note>{previewName(itemRef, listed)} can't be found: it may have been deleted or its handle changed. Check the handle, or look for the item in its binder's views.</Note>;
    case "error":
      return (
        <Note>
          Couldn't read {previewName(itemRef, listed)}: {shown.message}
        </Note>
      );
    case "unparseable":
      return (
        <>
          <Note>
            {lastPathPart(shown.item.path)} can't be parsed, so it has no handle and can't be opened here. Fix the file by hand ({shown.item.path}).
          </Note>
          <ProblemList problems={shown.item.problems} file={lastPathPart(shown.item.path)} className={PART} />
        </>
      );
    case "item": {
      const { item } = shown;
      const lines = propertyLines(item, binders.data?.binders);
      const body = item.body?.trim() ?? "";
      return (
        <>
          <div className={cn(PART, "flex items-start gap-3")}>
            <InlineMarkdown text={item.title ?? itemName(item)} className="flex-1 text-fg-primary" />
            {/* The spaces keep the handle a word apart in the text content; the flex gap only shows it apart. */}
            {item.handle === null ? null : (
              <>
                {" "}
                <span className="shrink-0 pt-0.5 font-mono text-xs text-fg-tertiary">{item.handle}</span>{" "}
              </>
            )}
          </div>
          {lines.length === 0 ? null : (
            <dl className={cn(PART, "grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs")}>
              {lines.map(({ name, value }) => (
                <div key={name} className="contents">
                  <dt className="text-fg-tertiary">{name}</dt>
                  <dd className="min-w-0 break-words text-fg-secondary">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {item.problems.length === 0 ? null : <ProblemList problems={item.problems} file={lastPathPart(item.path)} className={cn(PART, "text-danger")} />}
          {body === "" ? null : (
            <div className={cn(PART, "min-h-0 overflow-y-auto overscroll-contain")}>
              <Markdown text={body} className="text-fg-secondary" />
            </div>
          )}
          <Footer onOpen={onOpen} />
        </>
      );
    }
  }
};
