// What views may ask of the workbench they're shown in.
import { createContext, useContext } from "react";

export type WorkbenchActions = {
  /** Opens (or focuses) the tab for this view and params in the editor area. */
  openTab: (viewId: string, params: unknown) => void;
};

export const WorkbenchContext = createContext<WorkbenchActions | undefined>(undefined);

export const useWorkbench = (): WorkbenchActions => {
  const actions = useContext(WorkbenchContext);
  if (actions === undefined) throw new Error("useWorkbench is used outside the Workbench; render the view inside it.");
  return actions;
};
