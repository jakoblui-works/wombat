import { useCallback, useMemo } from "react";

import { DESK_ACTIVITY } from "../../activity-ids.ts";
import { useActivityState } from "../../shell/activity-state.ts";
import type { DeskLayout } from "./desk-layout.ts";

type DeskChange = (desk: DeskLayout) => DeskLayout;

/** Changes workspace `ws`'s Desk (saved with the shell). */
export type ChangeDesk = (change: DeskChange, ws: string) => void;

/** Each workspace's Desk as the user left it, and the one way to change it. */
export type DeskState = { deskOf: (ws: string) => DeskLayout; changeDesk: ChangeDesk };

// The Desk's state is its registered initial, what the shell's restore parsed by `DeskLayout`, or what the Desk wrote.
const asDesk = (state: unknown): DeskLayout => state as DeskLayout;

/** `changeDesk` keeps its identity; `deskOf` changes with the shell state. */
export const useDesk = (): DeskState => {
  const { of, change } = useActivityState(DESK_ACTIVITY);
  const deskOf = useCallback((ws: string) => asDesk(of(ws)), [of]);
  const changeDesk = useCallback<ChangeDesk>((update, ws) => change(ws, (state) => update(asDesk(state))), [change]);
  return useMemo(() => ({ deskOf, changeDesk }), [deskOf, changeDesk]);
};
