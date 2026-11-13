import { type AgentSummary, HARNESS_FEATURE, hasProcess, isRunning } from "@wombat/shared/api";
import { useEffect, useRef } from "react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../../../../components/ui/dialog";
import { ServiceError } from "../../../../data/client.ts";
import { useContextBreakdown } from "../../../../data/commands.ts";
import { asError, asSentence } from "../../../../lib/errors.ts";
import { footerSlot } from "../Composer/ComposerFooter/slots.ts";

const BUSY_MESSAGE = "Available once the agent is idle";

/** What the dialog says when the breakdown couldn't be had: `busy` means a turn is running. */
export const contextErrorMessage = (error: unknown): string =>
  error instanceof ServiceError && error.code === "busy" ? BUSY_MESSAGE : asError(error).message;

type Props = { agent: AgentSummary; features: readonly string[] | undefined; featuresError?: Error | null; refetchFeatures?: () => unknown; open: boolean; onOpenChange: (open: boolean) => void };

/** The context dialog's shell: asks for the breakdown each time it opens and hands it to the harness's `contextDialog` body. */
export const ContextDialogHost = ({ agent, features, featuresError, refetchFeatures, open, onOpenChange }: Props) => {
  const { mutate, reset, data, error } = useContextBreakdown();
  const supported = features?.includes(HARNESS_FEATURE.context);
  const busy = error !== null && contextErrorMessage(error) === BUSY_MESSAGE;
  const running = isRunning(agent);
  const wasRunning = useRef(running);
  const failedFeatures = useRef(featuresError);
  failedFeatures.current = featuresError;
  useEffect(() => {
    if (open && failedFeatures.current) refetchFeatures?.();
  }, [open, refetchFeatures]);
  useEffect(() => {
    if (open && supported) mutate(agent.id);
    else reset();
  }, [open, supported, agent.id, mutate, reset]);
  useEffect(() => {
    const finished = wasRunning.current && !running;
    wasRunning.current = running;
    if (finished && open && supported && busy && hasProcess(agent)) mutate(agent.id);
  }, [running, open, supported, busy, agent, mutate]);
  const message =
    supported === false
      ? "This agent's tool doesn't report context usage"
      : supported === undefined && featuresError
        ? `Couldn't read what this agent's tool offers: ${asSentence(featuresError.message)} Close this and open it again to retry.`
        : error === null
          ? undefined
          : contextErrorMessage(error);
  const Body = footerSlot(agent.harness, "contextDialog");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto">
        <DialogTitle className="pr-8">Context usage</DialogTitle>
        <DialogClose />
        <DialogDescription className="sr-only">How the agent's context window is used.</DialogDescription>
        <Body agent={agent} breakdown={data} error={message} />
      </DialogContent>
    </Dialog>
  );
};
