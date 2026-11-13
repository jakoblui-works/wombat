import { ArrowUp, Square } from "lucide-react";
import { useEffect, useReducer } from "react";

import { Button } from "../../../../components/ui/button";
import { sendMessageVars, useCancelTurn, useSendMessage } from "../../../../data/commands.ts";
import { appCommand, canSend, composerReducer, keyAction } from "./composer-state.ts";
import { forgetUnsent, openingComposer } from "./unsent.ts";

const STOPPED_ID = "composer-stopped";
export const STOPPED_TEXT = "This agent isn't running. Start a new agent to continue.";

type Props = {
  agentId: string;
  turnActive: boolean;
  connected: boolean;
  /** The agent has no process: the box is read-only and says why, since nothing would answer. */
  stopped: boolean;
  /** The agent's harness features (`GET /harnesses`): which app commands the text may be. */
  features: readonly string[];
  onOpenContext: () => void;
};

/** The message box: Send, and Cancel while a turn runs. */
export const Composer = ({ agentId, turnActive, connected, stopped, features, onOpenContext }: Props) => {
  // A message handed over (the first one, when it wasn't sent) shows as a failed send, its text in the box.
  const [state, dispatch] = useReducer(composerReducer, agentId, openingComposer);
  useEffect(() => forgetUnsent(agentId), [agentId]);
  const sending = useSendMessage();
  const cancelling = useCancelTurn();
  const sendable = canSend(state, { turnActive, connected, stopped });
  // A failed Cancel's error is about the turn it tried to end: gone once the turn changes.
  const resetCancel = cancelling.reset;
  useEffect(() => resetCancel(), [turnActive, resetCancel]);

  const send = () => {
    // Before canSend: the breakdown works while a turn runs (the dialog says if the agent isn't idle).
    if (appCommand(state.text, stopped ? [] : features) === "context") {
      dispatch({ type: "edit", text: "" });
      onOpenContext();
      return;
    }
    if (!sendable) return;
    dispatch({ type: "send" });
    cancelling.reset();
    sending.mutate(sendMessageVars(agentId, state.text), {
      onSuccess: () => dispatch({ type: "sent" }),
      onError: (error) => dispatch({ type: "failed", message: error.message }),
    });
  };

  return (
    <div className="shrink-0 px-5 pt-3 pb-2.5">
      <div className="mx-auto flex max-w-chat items-end gap-2 rounded-lg border border-line-strong bg-surface-2 py-1.5 pr-1.5 pl-3 transition-colors focus-within:border-focus">
        <textarea
          aria-label="Message"
          rows={1}
          placeholder="Reply to the agent…"
          readOnly={stopped}
          aria-disabled={stopped || undefined}
          aria-describedby={stopped ? STOPPED_ID : undefined}
          value={state.text}
          onChange={(event) => dispatch({ type: "edit", text: event.target.value })}
          onKeyDown={(event) => {
            if (keyAction({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing }) !== "send") return;
            event.preventDefault();
            send();
          }}
          className="max-h-48 min-w-0 flex-1 resize-none self-center bg-transparent text-base text-fg-primary outline-none field-sizing-content placeholder:text-fg-tertiary"
        />
        {turnActive ? (
          <Button variant="secondary" size="sm" disabled={!connected || cancelling.isPending} onClick={() => cancelling.mutate(agentId)}>
            <Square className="fill-current" />
            Cancel
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" disabled={!sendable} onClick={send}>
          <ArrowUp />
          Send
        </Button>
      </div>
      {stopped ? (
        <p id={STOPPED_ID} className="mx-auto max-w-chat px-3 pt-1.5 text-sm text-fg-secondary">
          {STOPPED_TEXT}
        </p>
      ) : null}
      {state.error === undefined && cancelling.error === null ? null : (
        <p role="alert" className="mx-auto max-w-chat px-3 pt-1.5 text-sm text-danger">
          {state.error === undefined ? `Couldn't cancel the turn: ${cancelling.error?.message ?? ""}` : `Couldn't send the message: ${state.error}`}
        </p>
      )}
    </div>
  );
};
