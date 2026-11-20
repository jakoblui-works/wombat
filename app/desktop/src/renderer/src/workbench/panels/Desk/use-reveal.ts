import { type RefObject, useEffect, useRef } from "react";

import type { Reveal } from "../../registry.ts";
import type { Row } from "./view-model/view-model.ts";
import { rowProposalIds } from "./view-model/with-proposals.ts";

/** The attribute a row holding proposals carries: their ids (`rowProposalIds`), space-separated. */
export const PROPOSAL_ATTRIBUTE = "data-proposal";

/** The `PROPOSAL_ATTRIBUTE` of a row, as props for its element. */
export const proposalProps = (row: Row): Record<string, string | undefined> => {
  const ids = rowProposalIds(row);
  return { [PROPOSAL_ATTRIBUTE]: ids.length === 0 ? undefined : ids.join(" ") };
};

/** The classes of a row that can be revealed: highlighted while it carries `data-revealed`. */
export const REVEALABLE = "rounded-md transition-colors data-revealed:bg-primary/10 data-revealed:ring-2 data-revealed:ring-primary/40";

const REVEALED_ATTRIBUTE = "data-revealed";

const HIGHLIGHT_MS = 2_000;
const WAIT_MS = 10_000;

const FOCUSABLE = 'button, [role="treeitem"], [tabindex]';

/** The element under `root` holding proposal `target`, if it shows. */
const holderOf = (root: HTMLElement, target: string): HTMLElement | null => root.querySelector<HTMLElement>(`[${PROPOSAL_ATTRIBUTE}~="${CSS.escape(target)}"]`);

type Highlight = { element: HTMLElement; timer: number };

const unhighlight = (highlight: Highlight | undefined): void => {
  if (highlight === undefined) return;
  window.clearTimeout(highlight.timer);
  highlight.element.removeAttribute(REVEALED_ATTRIBUTE);
};

/**
 * At each reveal request, the row under `ref` holding the proposal (`PROPOSAL_ATTRIBUTE`) is scrolled into
 * view, takes the focus, and is highlighted briefly (`data-revealed`), and `onShown` is called. A row that doesn't show
 * yet is waited for a while; a tree opens the row's ancestors itself. The highlight outlasts the request.
 */
export const useReveal = (reveal: Reveal | undefined, ref: RefObject<HTMLElement | null>, onShown?: () => void): void => {
  const highlight = useRef<Highlight>(undefined);
  const shownCallback = useRef(onShown);
  useEffect(() => {
    shownCallback.current = onShown;
  });
  useEffect(() => () => unhighlight(highlight.current), []);
  useEffect(() => {
    const root = ref.current;
    if (reveal === undefined || root === null) return;
    const show = (): boolean => {
      const holder = holderOf(root, reveal.target);
      if (holder === null) return false;
      holder.scrollIntoView({ block: "nearest" });
      (holder.matches(FOCUSABLE) ? holder : holder.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
      unhighlight(highlight.current);
      holder.setAttribute(REVEALED_ATTRIBUTE, "");
      highlight.current = { element: holder, timer: window.setTimeout(() => holder.removeAttribute(REVEALED_ATTRIBUTE), HIGHLIGHT_MS) };
      shownCallback.current?.();
      return true;
    };
    const observer = new MutationObserver(() => {
      if (show()) observer.disconnect();
    });
    if (!show()) observer.observe(root, { childList: true, subtree: true });
    const giveUp = window.setTimeout(() => observer.disconnect(), WAIT_MS);
    return () => {
      observer.disconnect();
      window.clearTimeout(giveUp);
    };
  }, [reveal, ref]);
};
