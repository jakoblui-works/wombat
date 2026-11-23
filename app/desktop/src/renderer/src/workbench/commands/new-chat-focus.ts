// New's ask that the empty chat's message box take the focus: kept until the box has mounted and takes it, since
// New may be what mounts it.
import { useSyncExternalStore } from "react";

let wanted = false;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const set = (next: boolean): void => {
  if (wanted === next) return;
  wanted = next;
  for (const listener of [...listeners]) listener();
};

export const wantNewChatFocus = (): void => set(true);

export const newChatFocusTaken = (): void => set(false);

/** Whether New asked for the focus and the box hasn't taken it yet (`newChatFocusTaken`). */
export const useNewChatFocusWanted = (): boolean => useSyncExternalStore(subscribe, () => wanted);
