import { type RefObject, useLayoutEffect, useRef } from "react";

/** How a popup was opened: by the pointer (it fades in) or the keyboard (it appears at once). */
export type OpenInput = "pointer" | "keyboard";

/**
 * Whether the event that opened something came from the pointer. A click with no pointer behind it (detail 0) is the
 * keyboard's Enter or Space on a trigger; Base UI's own programmatic opens carry an event of their own type.
 */
export const openedByPointer = (event: Event): boolean =>
  event.type.startsWith("pointer") ||
  event.type.startsWith("mouse") ||
  event.type === "contextmenu" ||
  (event.type === "click" && (event as MouseEvent).detail > 0);

export const openInput = (event: Event): OpenInput => (openedByPointer(event) ? "pointer" : "keyboard");

const NOT_YET = Symbol("not yet");

/**
 * Plays an animation class on the element `ref` gets when `key` changes (and, with `onMount`, when it first mounts),
 * but only if the element is in the document and shown at that moment. Dockview keeps inactive panels' content out
 * of the document, and an animation started there would play when the tab is clicked; such a change just shows. The
 * class goes when the animation ends or is cancelled, so a finished one doesn't start again when the element is moved.
 */
export const usePlay = <E extends Element>(className: string, key: unknown, { onMount = false } = {}): RefObject<E | null> => {
  const ref = useRef<E>(null);
  const last = useRef<unknown>(onMount ? NOT_YET : key);
  useLayoutEffect(() => {
    const changed = last.current !== key;
    last.current = key;
    const element = ref.current;
    if (!changed || element === null || !element.isConnected || !element.checkVisibility()) return;
    const stop = (event: Event) => {
      if (event.target !== element) return;
      element.classList.remove(className);
      element.removeEventListener("animationend", stop);
      element.removeEventListener("animationcancel", stop);
    };
    element.addEventListener("animationend", stop);
    element.addEventListener("animationcancel", stop);
    element.classList.add(className);
  }, [key, className]);
  return ref;
};
