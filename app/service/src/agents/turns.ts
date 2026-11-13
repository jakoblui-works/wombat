import { AgentErrorCode, SERVICE_STOP_REASON, type SendMessageRequest } from "@wombat/shared/api";

import { safeName, type Log } from "../log.ts";
import type { NewLogEntry } from "../store/store.ts";
import { isGoingAway, type AgentProcess } from "./agent-process.ts";
import type { AgentRecord } from "./agent-record.ts";
import { AgentError, busy, notResumable, notRunning, requireAgent, rpcCode, type AssertOpen } from "./errors.ts";
import { HIDDEN_BUSY } from "./hidden-turn.ts";
import type { Permissions } from "./permissions.ts";
import { endingByService, isHidden, isTurnOpen, next, takesCalls } from "./phase.ts";
import { now, type Proc } from "./proc.ts";
import type { Resume } from "./resume.ts";

const STILL_WORKING = "The agent is still working on the last message. Wait for it to finish, or cancel it.";

export type TurnsDeps = {
  log: Log;
  assertOpen: AssertOpen;
  summaryOf: AgentRecord["summaryOf"];
  hasAgent: AgentRecord["hasAgent"];
  storeEntries: AgentRecord["storeEntries"];
  appendLog: AgentRecord["appendLog"];
  setState: AgentRecord["setState"];
  agentState: AgentRecord["agentState"];
  refreshBranch: AgentRecord["refreshBranch"];
  knownCommands: AgentRecord["knownCommands"];
  safely: AgentRecord["safely"];
  cancelPending: Permissions["cancelPending"];
  procOf: AgentProcess["procOf"];
  isCurrent: AgentProcess["isCurrent"];
  liveProc: Resume["liveProc"];
  canResumeAgent: Resume["canResumeAgent"];
  ensureRunning: Resume["ensureRunning"];
};

/** The agents' turns: a message sent now, or stored while the agent is resumed, and its cancel. */
export const createTurns = ({
  log,
  assertOpen,
  summaryOf,
  hasAgent,
  storeEntries,
  appendLog,
  setState,
  agentState,
  refreshBranch,
  knownCommands,
  safely,
  cancelPending,
  procOf,
  isCurrent,
  liveProc,
  canResumeAgent,
  ensureRunning,
}: TurnsDeps) => {
  // Agents whose message is stored while their process is being resumed: the turn runs once it is (`resumeTurn`).
  const pendingTurns = new Set<string>();
  // Agents whose waiting message was cancelled before its resume finished: the turn ends without being sent.
  const cancelledTurns = new Set<string>();

  /** Whether a message waits for the agent's resume to run its turn. */
  const hasPendingTurn = (agentId: string) => pendingTurns.has(agentId);

  /** Ends the wait of the agent's message for its resume; true when the message was cancelled meanwhile. */
  const takePendingTurn = (agentId: string) => {
    pendingTurns.delete(agentId);
    return cancelledTurns.delete(agentId);
  };

  const runTurn = async (proc: Proc, text: string) => {
    const { agentId } = proc;
    try {
      const { stopReason } = await proc.acp.prompt(proc.sessionId, text);
      proc.phase = next(proc.phase, { type: "turnEnded" });
      cancelPending(proc);
      safely(agentId, "turn_ended", () => {
        appendLog(proc, [{ type: "turn_ended", stopReason }]);
        setState(proc, "done");
      });
      log("turn_ended", { agentId, stopReason: safeName(stopReason) });
      await refreshBranch(agentId, proc.cwd);
    } catch (error) {
      cancelPending(proc);
      // The connection closed, or the service is ending the process (whose answer may beat the close): the close
      // handler records why and ends the turn, so the turn stays open for it to see.
      if (isGoingAway(proc)) return;
      proc.phase = next(proc.phase, { type: "turnEnded" });
      const code = rpcCode(error);
      safely(agentId, "turn_failed", () => {
        appendLog(proc, [{ type: "turn_ended", stopReason: SERVICE_STOP_REASON.error }]);
        setState(proc, "error", {
          error: {
            code: AgentErrorCode.enum.agent_failed,
            message:
              `The agent reported an error during the turn${code === undefined ? "" : ` (ACP error ${code})`}. ` +
              "Send the message again, or stop the agent and start a new one.",
          },
        });
      });
      log("turn_failed", { agentId, code: code ?? -1 });
      await refreshBranch(agentId, proc.cwd);
    }
  };

  const storeMessage = (agentId: string, proc: Proc | undefined, text: string, commandId: string | undefined) => {
    const at = now();
    const message: NewLogEntry = { type: "user_message", at, text, ...(commandId === undefined ? {} : { commandId }) };
    const [seq = 0] = proc ? appendLog(proc, [message]) : storeEntries(agentId, [message]).seqs;
    if (commandId !== undefined) knownCommands(agentId).set(commandId, seq);
    return { seq, at };
  };

  const sendNow = (agentId: string, { text, commandId }: SendMessageRequest): { seq: number } => {
    assertOpen();
    requireAgent(agentId, summaryOf);
    if (commandId !== undefined) {
      const seq = knownCommands(agentId).get(commandId);
      if (seq !== undefined) {
        log("message_repeated", { agentId, seq });
        return { seq };
      }
    }
    const proc = liveProc(agentId);
    if (!proc) return sendResuming(agentId, text, commandId);
    if (isTurnOpen(proc.phase)) throw busy(STILL_WORKING);
    if (isHidden(proc.phase)) throw busy(HIDDEN_BUSY);
    const { seq, at } = storeMessage(agentId, proc, text, commandId);
    // The message is stored, so it is sent even if the state can't be: its turn ending clears `busy`.
    safely(agentId, "turn_started", () => setState(proc, "working", { lastUserAt: at }));
    proc.phase = next(proc.phase, { type: "turnStarted" });
    log("turn_started", { agentId, seq });
    void runTurn(proc, text);
    return { seq };
  };

  /**
   * `sendNow` for an agent without a live process: stores the message, then resumes the agent and runs its turn in the
   * background (`resumeTurn`); the caller gets the message's seq at once.
   */
  const sendResuming = (agentId: string, text: string, commandId: string | undefined): { seq: number } => {
    const summary = requireAgent(agentId, summaryOf);
    if (pendingTurns.has(agentId)) throw busy(STILL_WORKING);
    if (!canResumeAgent(summary)) throw notResumable();
    // A resume that has folded the log already (it is setting the agent's config again) folds the message too.
    const current = procOf(agentId);
    const resumed = current && takesCalls(current.phase) ? current : undefined;
    const { seq, at } = storeMessage(agentId, resumed, text, commandId);
    pendingTurns.add(agentId);
    safely(agentId, "turn_started", () => agentState(agentId, resumed, "working", { lastUserAt: at }));
    log("turn_started", { agentId, seq });
    void resumeTurn(agentId, text);
    return { seq };
  };

  /**
   * The background half of a message to an agent without a process: resumes it, then runs the stored message's turn.
   * A failed resume ends the turn as failed and leaves the agent in `error` with the attempt's message; one that
   * a stop or shutdown ended leaves it stopped.
   */
  const resumeTurn = async (agentId: string, text: string) => {
    let proc: Proc | undefined;
    let failure: unknown;
    try {
      proc = await ensureRunning(agentId);
    } catch (error) {
      failure = error;
    }
    const cancelled = takePendingTurn(agentId);
    if (proc !== undefined) {
      const resumed = proc;
      resumed.phase = next(resumed.phase, { type: "turnStarted" });
      // Ending already: its close handler ends the turn.
      if (endingByService(resumed.phase) && isCurrent(resumed)) return;
      if (!isCurrent(resumed)) {
        // Ended already: its close handler wrote the agent's state, but saw no turn.
        resumed.phase = next(resumed.phase, { type: "turnEnded" });
        if (hasAgent(agentId)) safely(agentId, "turn_stopped", () => storeEntries(agentId, [{ type: "turn_ended", stopReason: SERVICE_STOP_REASON.stopped }]));
        return;
      }
      if (cancelled) {
        // Cancelled while the agent was starting: the message never reaches it.
        resumed.phase = next(resumed.phase, { type: "turnEnded" });
        safely(agentId, "turn_cancelled", () => {
          appendLog(resumed, [{ type: "turn_ended", stopReason: "cancelled" }]);
          setState(resumed, "done");
        });
        log("turn_ended", { agentId, stopReason: "cancelled" });
        return;
      }
      safely(agentId, "turn_started", () => setState(resumed, "working"));
      await runTurn(resumed, text);
      return;
    }
    if (!hasAgent(agentId)) return;
    const stopped = failure instanceof AgentError && failure.code === AgentErrorCode.enum.not_running;
    const message = failure instanceof AgentError ? failure.message : "The agent couldn't be started again. Send the message again to retry.";
    safely(agentId, "turn_failed", () => {
      storeEntries(agentId, [{ type: "turn_ended", stopReason: stopped ? SERVICE_STOP_REASON.stopped : SERVICE_STOP_REASON.error }]);
      if (stopped) agentState(agentId, undefined, "stopped");
      else agentState(agentId, undefined, "error", { error: { code: AgentErrorCode.enum.agent_failed, message } });
    });
    log("turn_failed", { agentId, resumeError: failure instanceof AgentError ? failure.code : "unknown" });
  };

  // Async for callers, while the checks, the commandId lookup and the store write stay in one synchronous step.
  const send = (agentId: string, request: SendMessageRequest) =>
    Promise.resolve().then(() => sendNow(agentId, request));

  const cancel = async (agentId: string) => {
    assertOpen();
    const summary = requireAgent(agentId, summaryOf);
    if (pendingTurns.has(agentId)) {
      // The message waits for the agent to start: it is ended there, before it is sent (`resumeTurn`).
      cancelledTurns.add(agentId);
      log("turn_cancel_sent", { agentId, permissionsCancelled: 0 });
      return;
    }
    const proc = procOf(agentId);
    if (!proc || !takesCalls(proc.phase)) throw notRunning(canResumeAgent(summary));
    try {
      await proc.acp.cancel(proc.sessionId);
    } catch {
      // The connection closed meanwhile; the close handler records it.
    }
    // ACP: after session/cancel, the client answers the turn's open permission requests with `cancelled`.
    const cancelled = cancelPending(proc);
    const state = isTurnOpen(proc.phase) ? "working" : summaryOf(agentId)?.state;
    if (cancelled > 0 && state) safely(agentId, "cancel", () => setState(proc, state));
    log("turn_cancel_sent", { agentId, permissionsCancelled: cancelled });
  };

  return { send, cancel, hasPendingTurn };
};

export type Turns = ReturnType<typeof createTurns>;
