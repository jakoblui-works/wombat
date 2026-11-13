// Claude Code's desktop module: it overrides the context dialog for the service's Claude harness. It is imported once,
// where views are registered, and nothing under workbench/views reaches into harnesses/.
import { registerHarnessUi } from "../../workbench/views/Chat/Composer/ComposerFooter/slots.ts";
import { ClaudeContextDialog } from "./ClaudeContextDialog/ClaudeContextDialog.tsx";

// The registry refuses a harness twice, so a hot update of this module (in development) reloads the page instead.
const hot = import.meta.hot as { data: { registered?: boolean } } | undefined;
if (hot?.data.registered === true) location.reload();
else {
  registerHarnessUi("claude-code", { contextDialog: ClaudeContextDialog, hiddenOptions: ["agent"] });
  if (hot) hot.data.registered = true;
}
