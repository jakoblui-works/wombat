import { useCallback, useMemo } from "react";

import { DESK_ACTIVITY } from "../../activity-ids.ts";
import { type DeskLayout, deskOf } from "../../layout.ts";
import { changeActivityState } from "../../shell/shell-state.ts";
import { useShell } from "../../shell/ShellProvider.tsx";
import { useActivityState } from "../../workbench-context.ts";

type DeskChange = (desk: DeskLayout) => DeskLayout;

/** The Desk as the user left it, and the one way to change it (saved with the layout). */
export type DeskState = { desk: DeskLayout; changeDesk: (change: DeskChange) => void };

/** Changes workspace `ws`'s Desk, whichever workspace's activity states the caller sits in. */
export type ChangeDeskOf = (change: DeskChange, ws: string) => void;

const onDeskSlot =
  (change: DeskChange) =>
  (slot: unknown): DeskLayout =>
    change(deskOf(slot));

/** For the Desk's own panel: it re-renders on every change of the activities' states. */
export const useDesk = (): DeskState => {
  const { state, change } = useActivityState(DESK_ACTIVITY);
  const changeDesk = useCallback((update: DeskChange) => change(onDeskSlot(update)), [change]);
  return useMemo(() => ({ desk: deskOf(state), changeDesk }), [state, changeDesk]);
};

export const useChangeDeskOf = (): ChangeDeskOf => {
  const { change } = useShell();
  return useCallback((update, ws) => change((state) => changeActivityState(state, ws, DESK_ACTIVITY, onDeskSlot(update))), [change]);
};
