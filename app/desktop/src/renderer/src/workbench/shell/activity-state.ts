import { useCallback, useMemo } from "react";

import type { ActivityStateOf } from "../registry.ts";
import { activityStateOf, changeActivityState } from "./shell-state.ts";
import { useShell } from "./ShellProvider.tsx";

type ActivityState<T> = {
  of: (ws: string | undefined) => T;
  /** Saved with the shell, as any change the user makes. */
  change: (ws: string, update: (state: T) => T) => void;
};

// What the shell holds for a registered activity is its initial, what the restore parsed by its schema, or what this hook wrote.
const asState = <T,>(state: unknown): T => state as T;

/** The activity's state in any workspace; `change` keeps its identity, `of` changes with the shell state. */
export const useActivityState = <T,>({ id }: ActivityStateOf<T>): ActivityState<T> => {
  const { state, change: changeShell } = useShell();
  const of = useCallback((ws: string | undefined) => asState<T>(activityStateOf(state, ws, id)), [state, id]);
  const change = useCallback(
    (ws: string, update: (state: T) => T) => changeShell((current) => changeActivityState(current, ws, id, (stored) => update(asState<T>(stored)))),
    [changeShell, id],
  );
  return useMemo(() => ({ of, change }), [of, change]);
};
