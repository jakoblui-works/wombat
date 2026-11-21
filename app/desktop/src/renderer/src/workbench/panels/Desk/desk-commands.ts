// The Desk's commands on a focused row, registered on import. Each runs the handler of the row's `desk.row` scope root
// (`useCommandScope`); a root without one leaves the command's key alone.
import { registerCommand, runInScope } from "../../commands/registry.ts";

export const DESK_ROW_SCOPE = "desk.row";

export const DESK_COMMAND = { preview: "desk.row.preview", open: "desk.row.open", delete: "desk.row.delete" } as const;

const DESK_COMMANDS: { id: string; title: string; keys?: readonly string[] }[] = [
  { id: DESK_COMMAND.preview, title: "Preview Item", keys: ["space"] },
  { id: DESK_COMMAND.open, title: "Open Item", keys: ["enter"] },
  { id: DESK_COMMAND.delete, title: "Delete Item" },
];

// The registry refuses an id twice, so a hot update of this module (in development) reloads the page instead.
const hot = import.meta.hot as { data: { registered?: boolean } } | undefined;
if (hot?.data.registered === true) location.reload();
else {
  for (const command of DESK_COMMANDS) registerCommand({ ...command, scope: DESK_ROW_SCOPE, run: runInScope(DESK_ROW_SCOPE, command.id) });
  if (hot) hot.data.registered = true;
}
