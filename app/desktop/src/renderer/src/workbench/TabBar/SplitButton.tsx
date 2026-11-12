import type { IDockviewHeaderActionsProps } from "dockview-react";
import { Columns2 } from "lucide-react";

import { runLogged } from "../commands/registry.ts";
import { commandTitle, splitCommandId } from "../commands/workbench-commands.ts";

/** The group header's split button: a click splits the group to the right, Alt+click below. */
export const SplitButton = ({ group }: IDockviewHeaderActionsProps) => {
  const label = `${commandTitle(splitCommandId("right"))} (Alt: ${commandTitle(splitCommandId("down"))})`;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="focus-ring mx-1 flex size-6 cursor-default items-center self-center justify-center rounded-md text-fg-tertiary outline-none hover:bg-surface-3 hover:text-fg-primary"
      onClick={(event) => runLogged(splitCommandId(event.altKey ? "down" : "right"), { groupId: group.id })}
    >
      <Columns2 className="size-3.5" aria-hidden />
    </button>
  );
};
