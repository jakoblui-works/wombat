// Claude Code's desktop module: it overrides the context dialog for the service's Claude harness. It is imported once,
// where panels are registered, and nothing under workbench/panels reaches into harnesses/.
import { registerOnce } from "../../lib/register-once.ts";
import { registerHarnessUi } from "../../workbench/panels/Chat/Composer/ComposerFooter/slots.ts";
import { ClaudeContextDialog } from "./ClaudeContextDialog/ClaudeContextDialog.tsx";

registerOnce(import.meta.hot, () => registerHarnessUi("claude-code", { contextDialog: ClaudeContextDialog, hiddenOptions: ["agent"] }));
