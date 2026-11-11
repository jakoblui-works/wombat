import { ArrowUp, Square } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The message box: Send, and Cancel while a turn runs. */
export const Composer = () => (
  <div className="shrink-0 px-5 pt-3 pb-2.5">
    <div className="mx-auto flex max-w-chat items-end gap-2 rounded-lg border border-line-strong bg-surface-2 py-1.5 pr-1.5 pl-3 transition-colors focus-within:border-focus">
      <textarea
        aria-label="Message"
        rows={1}
        placeholder="Reply to the agent…"
        className="min-w-0 flex-1 resize-none self-center bg-transparent text-base text-fg-primary outline-none placeholder:text-fg-tertiary"
      />
      <Button variant="secondary" size="sm">
        <Square className="fill-current" />
        Cancel
      </Button>
      <Button variant="secondary" size="sm">
        <ArrowUp />
        Send
      </Button>
    </div>
  </div>
);
