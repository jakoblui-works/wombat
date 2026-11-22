import { type RefObject, useEffect, useRef, useState } from "react";

import type { Reveal } from "../../registry.ts";
import { opened, setClosed } from "./tree-keys.ts";
import { type Row, rowItemId } from "./view-model/view-model.ts";
import { rowProposalIds } from "./view-model/with-proposals.ts";

/** The attribute a row holding proposals carries: their ids (`rowProposalIds`), space-separated. */
export const PROPOSAL_ATTRIBUTE = "data-proposal";

/** The attribute an item's row carries: the item's id. */
export const ITEM_ATTRIBUTE = "data-item";

/** The `PROPOSAL_ATTRIBUTE` of a row, as props for its element. */
export const proposalProps = (row: Row): Record<string, string | undefined> => {
  const ids = rowProposalIds(row);
  return { [PROPOSAL_ATTRIBUTE]: ids.length === 0 ? undefined : ids.join(" ") };
};

/** What a row carries to be revealed by: its proposals' ids (`PROPOSAL_ATTRIBUTE`) and its item's id (`ITEM_ATTRIBUTE`), as props for its element. */
export const revealProps = (row: Row): Record<string, string | undefined> => ({ ...proposalProps(row), [ITEM_ATTRIBUTE]: rowItemId(row) });

/** Whether reveal target `target` (a proposal id or an item id) lands on the row carrying `props` (`revealProps`). */
export const carries = (props: Readonly<Record<string, string | undefined>>, target: string): boolean =>
  props[ITEM_ATTRIBUTE] === target || (props[PROPOSAL_ATTRIBUTE]?.split(" ").includes(target) ?? false);

/**
 * The target of the view's last reveal request, also after the request ends: its row keeps showing where the view's
 * filter would hide it (`isOutsideFilter`) for as long as the view shows.
 */
export const useLastRevealTarget = (reveal: Reveal | undefined): string | undefined => {
  const [last, setLast] = useState<string>();
  if (reveal !== undefined && reveal.target !== last) setLast(reveal.target);
  return reveal?.target ?? last;
};

/**
 * The keys of a view's closed rows, and `toggle` to open or close one. Once per reveal request, as soon as `above` finds
 * the request's row, the rows above it open; they stay open after the request ends.
 */
export const useClosedRows = (
  reveal: Reveal | undefined,
  above: (target: string) => readonly string[] | undefined,
): { closed: ReadonlySet<string>; toggle: (key: string, open: boolean) => void } => {
  const [closed, setClosedRows] = useState<ReadonlySet<string>>(new Set());
  const [openedFor, setOpenedFor] = useState<Reveal>();
  const keys = reveal === undefined || reveal === openedFor ? undefined : above(reveal.target);
  if (keys !== undefined) {
    setOpenedFor(reveal);
    setClosedRows((current) => opened(current, keys));
  }
  return { closed, toggle: (key, open) => setClosedRows((current) => setClosed(current, key, open)) };
};

/** The classes of a row that can be revealed: highlighted while it carries `data-revealed`. */
export const REVEALABLE = "rounded-md transition-colors data-revealed:bg-primary/10 data-revealed:ring-2 data-revealed:ring-primary/40";

const REVEALED_ATTRIBUTE = "data-revealed";

const HIGHLIGHT_MS = 2_000;
const WAIT_MS = 10_000;

const FOCUSABLE = 'button, [role="treeitem"], [tabindex]';

/** The reveal attributes an element carries, as `revealProps` gave them. */
const carried = (element: Element): Record<string, string | undefined> => ({
  [PROPOSAL_ATTRIBUTE]: element.getAttribute(PROPOSAL_ATTRIBUTE) ?? undefined,
  [ITEM_ATTRIBUTE]: element.getAttribute(ITEM_ATTRIBUTE) ?? undefined,
});

/** The element under `root` of the row `target` (a proposal id or an item id) lands on (`carries`), if it shows. */
const holderOf = (root: HTMLElement, target: string): HTMLElement | undefined =>
  [...root.querySelectorAll<HTMLElement>(`[${PROPOSAL_ATTRIBUTE}], [${ITEM_ATTRIBUTE}]`)].find((element) => carries(carried(element), target));

type Highlight = { element: HTMLElement; timer: number };

const unhighlight = (highlight: Highlight | undefined): void => {
  if (highlight === undefined) return;
  window.clearTimeout(highlight.timer);
  highlight.element.removeAttribute(REVEALED_ATTRIBUTE);
};

/**
 * At each reveal request, the row under `ref` holding the proposal or the item (`revealProps`) is scrolled into
 * view, takes the focus, and is highlighted briefly (`data-revealed`), and `onEnded` is called. A row that doesn't show
 * yet is waited for a while, then given up on, which calls `onEnded` too; a view opens the row's ancestors itself
 * (`useClosedRows`). The highlight outlasts the request.
 */
export const useReveal = (reveal: Reveal | undefined, ref: RefObject<HTMLElement | null>, onEnded?: () => void): void => {
  const highlight = useRef<Highlight>(undefined);
  const endedCallback = useRef(onEnded);
  useEffect(() => {
    endedCallback.current = onEnded;
  });
  useEffect(() => () => unhighlight(highlight.current), []);
  useEffect(() => {
    const root = ref.current;
    if (reveal === undefined || root === null) return;
    const show = (): boolean => {
      const holder = holderOf(root, reveal.target);
      if (holder === undefined) return false;
      holder.scrollIntoView({ block: "nearest" });
      (holder.matches(FOCUSABLE) ? holder : holder.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
      unhighlight(highlight.current);
      holder.setAttribute(REVEALED_ATTRIBUTE, "");
      highlight.current = { element: holder, timer: window.setTimeout(() => holder.removeAttribute(REVEALED_ATTRIBUTE), HIGHLIGHT_MS) };
      endedCallback.current?.();
      return true;
    };
    if (show()) return;
    const observer = new MutationObserver(() => {
      if (!show()) return;
      observer.disconnect();
      window.clearTimeout(giveUp);
    });
    observer.observe(root, { childList: true, subtree: true });
    const giveUp = window.setTimeout(() => {
      observer.disconnect();
      endedCallback.current?.();
    }, WAIT_MS);
    return () => {
      observer.disconnect();
      window.clearTimeout(giveUp);
    };
  }, [reveal, ref]);
};
