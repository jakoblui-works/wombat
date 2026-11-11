import { useState } from "react";

import { Button } from "../../../../components/ui/button";
import { shownText } from "../clip-text.ts";

/**
 * A text cut at MAX_SHOWN_CHARS until the user asks for all of it: what to show, and the line under it. The choice is
 * the component's state, so it lasts while the item stays in the chat.
 */
export const useClipped = (text: string) => {
  const [all, setAll] = useState(false);
  const { shown, omitted } = shownText(text, all);
  return { shown, omitted, showAll: () => setAll(true) };
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
