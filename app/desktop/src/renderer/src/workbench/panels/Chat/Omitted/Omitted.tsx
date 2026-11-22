import { useEffect, useRef, useState } from "react";

import { Button } from "../../../../components/ui/button";
import { shownText } from "../clip-text.ts";

/**
 * A text cut at MAX_SHOWN_CHARS until the user asks for all of it: what to show, and the line under it. The choice is
 * the component's state, so it lasts while the item stays in the chat. Show all goes away once used, so focus moves
 * to the text it expanded: put `textRef` on the text's element, with tabIndex -1.
 */
export const useClipped = <T extends HTMLElement>(text: string) => {
  const [all, setAll] = useState(false);
  const textRef = useRef<T>(null);
  // `all` only turns true through Show all.
  useEffect(() => {
    if (all) textRef.current?.focus();
  }, [all]);
  const { shown, omitted } = shownText(text, all);
  return { shown, omitted, textRef, showAll: () => setAll(true) };
};

/** The line under a clipped text, saying how much isn't shown, with Show all; nothing when it all is. */
export const Omitted = ({ count, onShowAll }: { count: number; onShowAll: () => void }) =>
  count === 0 ? null : (
    <p className="flex items-center gap-2 pt-1 text-xs text-fg-tertiary">
      {count.toLocaleString("en")} characters left out
      <Button variant="ghost" size="xs" onClick={onShowAll}>
        Show all
      </Button>
    </p>
  );
