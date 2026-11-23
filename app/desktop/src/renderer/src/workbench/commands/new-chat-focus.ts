// New's ask that the empty chat's message box take the focus: kept until the box has mounted and takes it, since
// New may be what mounts it.
import { useSyncExternalStore } from "react";

/** New's ask: the element that had the focus when it asked (null without a page). */
export type NewChatFocusRequest = { from: Element | null };

let wanted: NewChatFocusRequest | undefined;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const set = (next: NewChatFocusRequest | undefined): void => {
  if (wanted === next) return;
  wanted = next;
  for (const listener of [...listeners]) listener();
};

export const wantNewChatFocus = (): void => set({ from: typeof document === "undefined" ? null : document.activeElement });

export const newChatFocusTaken = (): void => set(undefined);

/** New's ask while the box hasn't taken it yet (`newChatFocusTaken`), else undefined. */
export const useNewChatFocusWanted = (): NewChatFocusRequest | undefined => useSyncExternalStore(subscribe, () => wanted);

/**
 * Whether the box may take the focus New asked for: the focus (`now`) is still on the element it was on when New asked
 * (`atRequest`), on none or the page itself, or in the title bar's menus (`nowInMenus`). Anywhere else the user has put
 * it since, and the ask is dropped.
 */
export const newChatFocusStands = (
  atRequest: { readonly tagName: string } | null,
  now: { readonly tagName: string } | null,
  nowInMenus: boolean,
): boolean => now === null || now === atRequest || now.tagName === "BODY" || nowInMenus;
