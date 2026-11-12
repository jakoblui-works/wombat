import { ContextDialog } from "../../../workbench/views/Chat/Composer/ComposerFooter/ContextDialog/ContextDialog.tsx";
import type { ContextDialogProps } from "../../../workbench/views/Chat/Composer/ComposerFooter/slots.ts";

/**
 * Claude's variation of the context dialog, so /context with Claude Code looks like Claude's VS Code extension: its
 * colour per category and the /memory and /agents commands beside their lists. The layout is the default's. It
 * depends only on `ContextBreakdown`; everything specific to Claude's own report lives in the service's harness.
 */

/** Claude's colour per category, by the name Claude sends; a name not listed here gets the default colour. */
const CLAUDE_SWATCH = new Map([
  ["System prompt", "bg-[#d98a1a]"],
  ["System tools", "bg-[#5aa0ff]"],
  ["MCP tools", "bg-[#7ed38a]"],
  ["MCP server instructions", "bg-[#7ed38a]"],
  ["Custom agents", "bg-[#d4b012]"],
  ["Memory files", "bg-[#b48ae0]"],
  ["Skills", "bg-[#ef4f4f]"],
  ["Messages", "bg-[#30c4cc]"],
  ["Autocompact buffer", "bg-[#b4bcc8]"],
]);

const DEFAULT_SWATCH = "bg-fg-tertiary/60";

/** The slash command that manages a list, by the list's id. */
const LIST_COMMANDS = new Map([
  ["memory_files", "/memory"],
  ["custom_agents", "/agents"],
]);

export const ClaudeContextDialog = (props: ContextDialogProps) => (
  <ContextDialog
    {...props}
    // Free space has no swatch; the bar's track shows it.
    swatchOf={({ name, kind }) => (kind === "free" ? "bg-transparent" : (CLAUDE_SWATCH.get(name) ?? DEFAULT_SWATCH))}
    listAside={(id) => {
      const command = LIST_COMMANDS.get(id);
      return command === undefined ? null : <span className="font-mono normal-case tracking-normal">{command}</span>;
    }}
  />
);
