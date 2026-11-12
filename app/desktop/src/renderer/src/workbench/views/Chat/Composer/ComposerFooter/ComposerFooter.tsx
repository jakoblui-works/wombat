import type { AgentSummary, ConfigOption } from "@wombat/shared/api";
import { useState } from "react";

import type { Usage } from "../../../../../data/chat-model.ts";
import { asError } from "../../../../../lib/errors.ts";
import { footerSlot } from "./slots.ts";

type Props = {
  agent: AgentSummary;
  toolName: string;
  options: ConfigOption[] | undefined;
  usage: Usage | undefined;
  /** Sets an option; a rejection is shown under the footer. */
  onSet: (configId: string, value: string | boolean) => Promise<unknown> | void;
};

/** Under the message box: the agent's tool, then the harness's `settings` and `context` slots (its own, else the defaults). */
export const ComposerFooter = ({ agent, toolName, options, usage, onSet }: Props) => {
  const [failure, setFailure] = useState<string>();
  // Values shown are always the log's (`options`); only the error of the last set is kept here.
  const setConfig = async (configId: string, value: string | boolean): Promise<void> => {
    try {
      await onSet(configId, value);
      setFailure(undefined);
    } catch (error) {
      setFailure(asError(error).message);
    }
  };
  const Settings = footerSlot(agent.harness, "settings");
  const Context = footerSlot(agent.harness, "context");
  const slotProps = { agent, config: options, usage, setConfig, failure };
  return (
    <div className="shrink-0 px-5 pb-2">
      <div className="mx-auto w-full max-w-chat">
        <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm text-fg-tertiary">{toolName}</span>
          <Settings {...slotProps} />
          <Context {...slotProps} />
        </div>
        {failure === undefined ? null : (
          <p role="alert" className="pt-1 text-sm text-danger">
            {failure}
          </p>
        )}
      </div>
    </div>
  );
};
