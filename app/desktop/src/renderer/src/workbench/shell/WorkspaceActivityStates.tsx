import { type ReactNode, useCallback } from "react";

import { ActivityStateContext, ChangeActivityStateContext, type ChangeActivityStates } from "../workbench-context.ts";
import { activityStatesOf, changeActivityState } from "./shell-state.ts";
import { useShell } from "./ShellProvider.tsx";

/** Gives the panels inside `workspace`'s activity states from the shell state; with no workspace a change does nothing. */
export const WorkspaceActivityStates = ({ workspace, children }: { workspace: string | undefined; children: ReactNode }) => {
  const { state, change } = useShell();
  const changeStates = useCallback<ChangeActivityStates>(
    (activityId, update) => {
      if (workspace !== undefined) change((current) => changeActivityState(current, workspace, activityId, update));
    },
    [change, workspace],
  );
  return (
    <ActivityStateContext value={activityStatesOf(state, workspace)}>
      <ChangeActivityStateContext value={changeStates}>{children}</ChangeActivityStateContext>
    </ActivityStateContext>
  );
};
