import type { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import { type AriaAttributes, type FocusEvent, type ReactElement, type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";

import { createPreviewCardHandle, PreviewCard, PreviewCardTrigger } from "../../../../components/ui/preview-card";
import type { OpenOptions } from "../../../workbench-context.ts";
import type { FlatRow } from "../tree-keys.ts";
import { ItemPreview, ItemPreviewContent, PREVIEW_CLOSE_DELAY_MS, PREVIEW_DELAY_MS } from "./ItemPreview.tsx";
import { previewOnFocus, previewOnSpace, type PreviewTarget } from "./item-preview.ts";

type Options<N> = {
  rows: readonly FlatRow<N>[];
  /** What a row's box previews; none for a row without a box. */
  previewOf: ((row: FlatRow<N>) => PreviewTarget | undefined) | undefined;
  onOpen: (row: FlatRow<N>, options: OpenOptions) => void;
  /** The view's root: the box opens beside its right edge, and the focus leaving it turns the box off. */
  within: RefObject<HTMLElement | null>;
};

// The box opens on the pointer and on Space, not on focus: Base UI's own focus and blur handlers on a trigger are skipped.
const withoutFocusOpen = (event: FocusEvent & { preventBaseUIHandler: () => void }) => event.preventBaseUIHandler();

/** A virtual anchor at `row`'s height whose right edge is `within`'s, so the box opens next to the sidebar. */
const besideRow = (row: Element, within: RefObject<HTMLElement | null>) => ({
  contextElement: row,
  getBoundingClientRect: () => {
    const { left, top, height } = row.getBoundingClientRect();
    const right = within.current?.getBoundingClientRect().right ?? row.getBoundingClientRect().right;
    return DOMRect.fromRect({ x: left, y: top, width: Math.max(0, right - left), height });
  },
});

// Base UI exports its reasons only from an internal path; the type checks this copy against the public reason type.
const IMPERATIVE: PreviewCardPrimitive.Root.ChangeEventReason = "imperative-action";

/**
 * One preview box shared by a view's rows: it opens on a row after the hover delay, and Space (`toggle`) turns its
 * keyboard mode on and off (`previewOnSpace`, `previewOnFocus`); `follow` on each focus move, `open` for a click or
 * Enter, and `onBlur` on the view's root for the focus leaving it. It closes when its row goes.
 */
export const useRowPreview = <N,>({ rows, previewOf, onOpen, within }: Options<N>) => {
  const [handle] = useState(() => createPreviewCardHandle());
  const [open, setOpen] = useState(false);
  // The last row the box opened on, kept while it closes so its content stays for the fade.
  const [trigger, setTrigger] = useState<Element>();
  const on = useRef(false);
  const popup = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const idOf = (key: string) => `${prefix}${encodeURIComponent(key)}`;
  const row = trigger === undefined ? undefined : rows.find(({ key }) => trigger.id === idOf(key));
  const target = row === undefined ? undefined : previewOf?.(row);
  const keys = () => ({ on: on.current, openKey: open ? row?.key : undefined });
  const previewable = (key: string) => {
    const each = rows.find((candidate) => candidate.key === key);
    return each !== undefined && previewOf?.(each) !== undefined;
  };
  const show = (key: string, action: "open" | "close") => (action === "open" ? handle.open(idOf(key)) : handle.close());
  const off = () => {
    on.current = false;
    handle.close();
  };
  const openRow = (shown: FlatRow<N>, options: OpenOptions) => {
    off();
    onOpen(shown, options);
  };
  const anchor = useMemo(() => (trigger === undefined ? undefined : besideRow(trigger, within)), [trigger, within]);
  const gone = open && (target === undefined || trigger?.isConnected !== true);

  useEffect(() => {
    if (gone) handle.close();
  }, [gone, handle]);

  return {
    toggle: (key: string) => {
      const next = previewOnSpace(keys(), key, previewable(key));
      on.current = next.on;
      show(key, next.action);
    },
    follow: (key: string) => {
      const action = previewOnFocus(keys(), key, previewable(key));
      if (action !== undefined) show(key, action);
    },
    /** Turns the box off and opens the row: temporary for a click and Enter, as the box's Open does; kept for a double click. */
    open: openRow,
    onBlur: (event: FocusEvent) => {
      const next = event.relatedTarget;
      // A click in the box moves the focus into it (`ItemPreviewContent`), which counts as staying.
      if (next instanceof Node && (within.current?.contains(next) === true || popup.current?.contains(next) === true)) return;
      off();
    },
    /** `element` as row `row`'s trigger of the box, or as it is for a row without one. */
    trigger: (row: FlatRow<N>, element: ReactElement<AriaAttributes>): ReactElement<AriaAttributes> =>
      previewOf?.(row) === undefined ? (
        element
      ) : (
        <PreviewCardTrigger
          handle={handle}
          id={idOf(row.key)}
          delay={PREVIEW_DELAY_MS}
          closeDelay={PREVIEW_CLOSE_DELAY_MS}
          render={element}
          onFocus={withoutFocusOpen}
          onBlur={withoutFocusOpen}
        />
      ),
    box: (
      <PreviewCard
        handle={handle}
        onOpenChange={(opened, details) => {
          setOpen(opened);
          if (opened) setTrigger(details.trigger);
          else if (details.reason !== IMPERATIVE) on.current = false;
        }}
      >
        {target === undefined || row === undefined ? null : (
          <ItemPreviewContent ref={popup} anchor={anchor}>
            <ItemPreview itemRef={target.itemRef} listed={target.listed} onOpen={() => openRow(row, { temporary: true })} />
          </ItemPreviewContent>
        )}
      </PreviewCard>
    ),
  };
};
