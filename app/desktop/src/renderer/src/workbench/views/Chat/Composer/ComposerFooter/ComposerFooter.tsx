import type { AgentSummary, ChatAccess, ConfigOption } from "@wombat/shared/api";
import { useState } from "react";

import type { Usage } from "../../../../../data/chat-model.ts";
import { asError } from "../../../../../lib/errors.ts";
import { NotRunning } from "./NotRunning/NotRunning.tsx";
import { footerSlot } from "./slots.ts";

type Props = {
  agent: AgentSummary;
  toolName: string;
  options: ConfigOption[] | undefined;
  usage: Usage | undefined;
  /**
   * Whether the agent takes a set (Chat decides, by `chatAccess`): without a process, NotRunning replaces the
   * `context` slot; a `resumable` agent's settings still work (a set starts it), a `closed` one's can't change and a
   * stale failure is hidden.
   */
  access?: ChatAccess;
  /** Sets an option; a rejection is shown under the footer. */
  onSet: (configId: string, value: string | boolean) => Promise<unknown> | void;
};

/**
 * Under the message box: the agent's tool, then the harness's `settings` and `context` slots (its own, else the
 * defaults). For an agent without a process, the NotRunning indicator takes the `context` slot's place, whatever the
 * harness's own: the one owner of it.
 */
export const ComposerFooter = ({ agent, toolName, options, usage, access = "running", onSet }: Props) => {
  const [failure, setFailure] = useState<string>();
  // Sets still waiting for the agent to start.
  const [starting, setStarting] = useState(0);
  // Values shown are always the log's (`options`); only the error of the last set is kept here.
  const setConfig = async (configId: string, value: string | boolean): Promise<void> => {
    const starts = access !== "running";
    if (starts) setStarting((count) => count + 1);
    try {
      await onSet(configId, value);
      setFailure(undefined);
    } catch (error) {
      setFailure(asError(error).message);
    } finally {
      if (starts) setStarting((count) => count - 1);
    }
  };
  const closed = access === "closed";
  const Settings = footerSlot(agent.harness, "settings");
  const Context = footerSlot(agent.harness, "context");
  const slotProps = { agent, config: options, usage, setConfig, failure: closed ? undefined : failure, access, starting: starting > 0 };
  return (
    <div className="shrink-0 px-5 pb-2">
      <div className="mx-auto w-full max-w-chat">
        <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm text-fg-tertiary">{toolName}</span>
          <Settings {...slotProps} />
          {access === "running" ? <Context {...slotProps} /> : <NotRunning access={access} />}
        </div>
        {failure === undefined || closed ? null : (
          <p role="alert" className="pt-1 text-sm text-danger">
            {failure}
          </p>
        )}
      </div>
    </div>
  );
};
