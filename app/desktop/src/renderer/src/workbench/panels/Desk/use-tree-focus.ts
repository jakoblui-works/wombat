import { useRef, useState } from "react";

/** A tree's one roving tab stop over its visible rows' keys: the focused row, else the first. */
export const useTreeFocus = (keys: readonly string[]) => {
  const [focused, setFocused] = useState<string>();
  const elements = useRef(new Map<string, HTMLElement>());
  const tabbable = Math.max(0, keys.indexOf(focused ?? ""));
  return {
    tabIndex: (index: number): number => (index === tabbable ? 0 : -1),
    register: (key: string) => (element: HTMLElement | null) => {
      if (element === null) elements.current.delete(key);
      else elements.current.set(key, element);
    },
    element: (key: string): HTMLElement | undefined => elements.current.get(key),
    onFocus: setFocused,
    focus: (key: string) => {
      setFocused(key);
      elements.current.get(key)?.focus();
    },
  };
};
