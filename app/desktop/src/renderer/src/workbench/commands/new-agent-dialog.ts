// Whether the New agent dialog is open. Kept outside the Agents sidebar, which isn't mounted while another activity
// shows: the agent.new command opens the dialog from anywhere, and it shows once Agents does.
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export const setNewAgentDialogOpen = (next: boolean): void => {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether the dialog is open, and its setter. */
export const useNewAgentDialog = (): [boolean, (open: boolean) => void] => [useSyncExternalStore(subscribe, () => open), setNewAgentDialogOpen];
