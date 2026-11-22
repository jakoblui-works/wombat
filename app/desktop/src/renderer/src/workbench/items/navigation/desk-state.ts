import { useMemo } from "react";

import { DESK_ACTIVITY } from "../../activity-ids.ts";
import { DEFAULT_DESK, type DeskLayout } from "../../layout.ts";
import { type ActivityState, useActivityState, useChangeActivityState } from "../../workbench-context.ts";

/** The Desk as the user left it, and the one way to change it (saved with the layout). */
export type DeskState = { desk: DeskLayout; changeDesk: (change: (desk: DeskLayout) => DeskLayout) => void };

/** The Desk's slot holds only what layout.ts and `changeDesk` wrote, so it's trusted as it is; an empty slot is `DEFAULT_DESK`. */
export const deskOf = (slot: unknown): DeskLayout => (slot === undefined ? DEFAULT_DESK : (slot as DeskLayout));

export const deskChange =
  (change: ActivityState["change"]): DeskState["changeDesk"] =>
  (changeDesk) =>
    change((slot) => changeDesk(deskOf(slot)));

/** For the Desk's own panel: it re-renders on every change of the activities' states. */
export const useDesk = (): DeskState => {
  const { state, change } = useActivityState(DESK_ACTIVITY);
  const changeDesk = useMemo(() => deskChange(change), [change]);
  return useMemo(() => ({ desk: deskOf(state), changeDesk }), [state, changeDesk]);
};

/** The Desk's change function alone; its identity lasts as long as the Workbench's. */
export const useChangeDesk = (): DeskState["changeDesk"] => {
  const change = useChangeActivityState(DESK_ACTIVITY);
  return useMemo(() => deskChange(change), [change]);
};
