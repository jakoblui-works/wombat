import type { AgentSummary } from "@wombat/shared/api";
import { useEffect } from "react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../../../../components/ui/dialog";
import { ServiceError } from "../../../../data/client.ts";
import { useContextBreakdown } from "../../../../data/commands.ts";
import { asError } from "../../../../lib/errors.ts";
import { footerSlot } from "../Composer/ComposerFooter/slots.ts";

/** What the dialog says when the breakdown couldn't be had: `busy` means a turn is running. */
export const contextErrorMessage = (error: unknown): string =>
  error instanceof ServiceError && error.code === "busy" ? "Available once the agent is idle" : asError(error).message;

type Props = { agent: AgentSummary; open: boolean; onOpenChange: (open: boolean) => void };

/** The context dialog's shell: asks for the breakdown each time it opens and hands it to the harness's `contextDialog` body. */
export const ContextDialogHost = ({ agent, open, onOpenChange }: Props) => {
  const { mutate, reset, data, error } = useContextBreakdown();
  useEffect(() => {
    if (open) mutate(agent.id);
    else reset();
  }, [open, agent.id, mutate, reset]);
  const Body = footerSlot(agent.harness, "contextDialog");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto">
        <DialogTitle className="pr-8">Context usage</DialogTitle>
        <DialogClose />
        <DialogDescription className="sr-only">How the agent's context window is used.</DialogDescription>
        <Body agent={agent} breakdown={data} error={error === null ? undefined : contextErrorMessage(error)} />
      </DialogContent>
    </Dialog>
  );
};
