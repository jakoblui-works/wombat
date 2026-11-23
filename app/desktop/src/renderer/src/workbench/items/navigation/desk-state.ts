import { useCallback, useMemo } from "react";

import { useActivityState } from "../../shell/activity-state.ts";
import { DESK_STATE, type DeskLayout } from "./desk-layout.ts";

type DeskChange = (desk: DeskLayout) => DeskLayout;

/** Changes workspace `ws`'s Desk (saved with the shell). */
export type ChangeDesk = (change: DeskChange, ws: string) => void;

/** Each workspace's Desk as the user left it, and the one way to change it. */
export type DeskState = { deskOf: (ws: string) => DeskLayout; changeDesk: ChangeDesk };

/** `changeDesk` keeps its identity; `deskOf` changes with the shell state. */
export const useDesk = (): DeskState => {
  const { of, change } = useActivityState(DESK_STATE);
  const deskOf = useCallback((ws: string) => of(ws), [of]);
  const changeDesk = useCallback<ChangeDesk>((update, ws) => change(ws, update), [change]);
  return useMemo(() => ({ deskOf, changeDesk }), [deskOf, changeDesk]);
};
