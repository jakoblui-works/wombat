// The Desk's commands on a focused row, registered on import. Each runs the handler of the row's `desk.row` scope root
// (`useCommandScope`); a root without one leaves the command's key alone.
import { registerOnce } from "../../../lib/register-once.ts";
import { registerCommand, runInScope } from "../../commands/registry.ts";

export const DESK_ROW_SCOPE = "desk.row";

export const DESK_COMMAND = { preview: "desk.row.preview", open: "desk.row.open", delete: "desk.row.delete" } as const;

const DESK_COMMANDS: { id: string; title: string; keys?: readonly string[] }[] = [
  { id: DESK_COMMAND.preview, title: "Preview Item", keys: ["space"] },
  { id: DESK_COMMAND.open, title: "Open Item", keys: ["enter", "numpad_enter"] },
  { id: DESK_COMMAND.delete, title: "Delete Item" },
];

registerOnce(import.meta.hot, () => {
  for (const command of DESK_COMMANDS) registerCommand({ ...command, scope: DESK_ROW_SCOPE, run: runInScope(DESK_ROW_SCOPE, command.id) });
});
