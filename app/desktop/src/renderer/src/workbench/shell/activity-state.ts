import { useCallback, useMemo } from "react";

import { activityStateOf, changeActivityState } from "./shell-state.ts";
import { useShell } from "./ShellProvider.tsx";

export type ActivityState = {
  of: (ws: string | undefined) => unknown;
  /** Saved with the shell, as any change the user makes. */
  change: (ws: string, update: (state: unknown) => unknown) => void;
};

/** The activity's state in any workspace; `change` keeps its identity, `of` changes with the shell state. */
export const useActivityState = (activityId: string): ActivityState => {
  const { state, change: changeShell } = useShell();
  const of = useCallback((ws: string | undefined) => activityStateOf(state, ws, activityId), [state, activityId]);
  const change = useCallback(
    (ws: string, update: (state: unknown) => unknown) => changeShell((current) => changeActivityState(current, ws, activityId, update)),
    [changeShell, activityId],
  );
  return useMemo(() => ({ of, change }), [of, change]);
};
