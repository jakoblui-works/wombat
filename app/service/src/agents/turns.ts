import { AgentErrorCode, SERVICE_STOP_REASON, type SendMessageRequest } from "@wombat/shared/api";

import { safeName, type Log } from "../log.ts";
import type { NoteSource, PreparedNote } from "../proposals/note-source.ts";
import { carriesNote, promptOf } from "../proposals/note.ts";
import type { NewLogEntry, Store } from "../store/store.ts";
import { isGoingAway, type AgentProcess } from "./agent-process.ts";
import type { AgentRecord } from "./agent-record.ts";
import { AgentError, busy, notResumable, notRunning, requireAgent, rpcCode, type AssertOpen } from "./errors.ts";
import { HIDDEN_BUSY } from "./hidden-turn.ts";
import type { Permissions } from "./permissions.ts";
import { endingByService, isHidden, isTurnOpen, next, takesCalls } from "./phase.ts";
import { now, type Proc } from "./proc.ts";
import type { Resume } from "./resume.ts";

const STILL_WORKING = "The agent is still working on the last message. Wait for it to finish, or cancel it.";

const COMMAND_WITH_PROPOSAL =
  "A message that starts with / is a command for the agent, so it can't be about a proposal. Send it without the proposal, or reword it so it doesn't start with /.";

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
  /** What the next message tells the agent about its proposals. */
  notes: () => NoteSource;
  markDelivered: Store["markDelivered"];
  markNotDelivered: Store["markNotDelivered"];
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
  notes,
  markDelivered,
  markNotDelivered,
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

  const runTurn = async (proc: Proc, prompt: string) => {
    const { agentId } = proc;
    try {
      const { stopReason } = await proc.acp.prompt(proc.sessionId, prompt);
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

  /**
   * Stores the message, with the note on the agent's proposals just before it when there is something to tell, and
   * returns the prompt: the note's rendering, then the text. The outcomes the note tells are marked delivered in the
   * same transaction, so an outcome is told by the one message that stores it; `noteSeq` names that note for a turn
   * that ends before its prompt is sent. Throws, storing nothing, when the message's proposal isn't the agent's open
   * one, or the message is a command and names a proposal.
   */
  const storeMessage = (agentId: string, proc: Proc | undefined, { text, commandId, proposalId }: SendMessageRequest, prepared: PreparedNote) => {
    const told = carriesNote(text);
    if (!told && proposalId !== undefined) throw new AgentError("invalid_request", COMMAND_WITH_PROPOSAL);
    const { note, delivers } = told ? notes().current(agentId, proposalId, prepared) : { note: undefined, delivers: [] };
    const at = now();
    const message: NewLogEntry = { type: "user_message", at, text, ...(commandId === undefined ? {} : { commandId }) };
    const entries: NewLogEntry[] = note === undefined ? [message] : [{ type: "proposal_note", at, ...note }, message];
    const deliver = ([noteSeq = 0]: number[]) => {
      if (note !== undefined && delivers.length > 0) markDelivered(delivers, noteSeq);
    };
    const seqs = proc ? appendLog(proc, entries, deliver) : storeEntries(agentId, entries, deliver).seqs;
    const seq = seqs.at(-1) ?? 0;
    if (commandId !== undefined) knownCommands(agentId).set(commandId, seq);
    return { seq, at, prompt: promptOf(note, text), noteSeq: delivers.length > 0 ? seqs[0] : undefined };
  };

  const sendNow = (agentId: string, request: SendMessageRequest, prepared: PreparedNote): { seq: number } => {
    const { commandId } = request;
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
    if (!proc) return sendResuming(agentId, request, prepared);
    if (isTurnOpen(proc.phase)) throw busy(STILL_WORKING);
    if (isHidden(proc.phase)) throw busy(HIDDEN_BUSY);
    const { seq, at, prompt } = storeMessage(agentId, proc, request, prepared);
    // The message is stored, so it is sent even if the state can't be: its turn ending clears `busy`.
    safely(agentId, "turn_started", () => setState(proc, "working", { lastUserAt: at }));
    proc.phase = next(proc.phase, { type: "turnStarted" });
    log("turn_started", { agentId, seq });
    void runTurn(proc, prompt);
    return { seq };
  };

  /**
   * `sendNow` for an agent without a live process: stores the message, then resumes the agent and runs its turn in the
   * background (`resumeTurn`); the caller gets the message's seq at once.
   */
  const sendResuming = (agentId: string, request: SendMessageRequest, prepared: PreparedNote): { seq: number } => {
    const summary = requireAgent(agentId, summaryOf);
    if (pendingTurns.has(agentId)) throw busy(STILL_WORKING);
    if (!canResumeAgent(summary)) throw notResumable();
    // A resume that has folded the log already (it is setting the agent's config again) folds the message too.
    const current = procOf(agentId);
    const resumed = current && takesCalls(current.phase) ? current : undefined;
    const { seq, at, prompt, noteSeq } = storeMessage(agentId, resumed, request, prepared);
    pendingTurns.add(agentId);
    safely(agentId, "turn_started", () => agentState(agentId, resumed, "working", { lastUserAt: at }));
    log("turn_started", { agentId, seq });
    void resumeTurn(agentId, prompt, noteSeq);
    return { seq };
  };

  /**
   * The background half of a message to an agent without a process: resumes it, then runs the stored message's turn.
   * A failed resume ends the turn as failed and leaves the agent in `error` with the attempt's message; one that
   * a stop or shutdown ended leaves it stopped. Unless its prompt is handed to the agent, the note stored as `noteSeq`
   * is marked not delivered: with the turn's end where this writes one, otherwise on the way out.
   */
  const resumeTurn = async (agentId: string, prompt: string, noteSeq: number | undefined) => {
    let handedOver = false;
    let unmarked = false;
    const neverSent = () => {
      if (noteSeq !== undefined) markNotDelivered(noteSeq);
      unmarked = true;
    };
    try {
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
          if (hasAgent(agentId)) safely(agentId, "turn_stopped", () => storeEntries(agentId, [{ type: "turn_ended", stopReason: SERVICE_STOP_REASON.stopped }], neverSent));
          return;
        }
        if (cancelled) {
          // Cancelled while the agent was starting: the message never reaches it.
          resumed.phase = next(resumed.phase, { type: "turnEnded" });
          safely(agentId, "turn_cancelled", () => {
            appendLog(resumed, [{ type: "turn_ended", stopReason: "cancelled" }], neverSent);
            setState(resumed, "done");
          });
          log("turn_ended", { agentId, stopReason: "cancelled" });
          return;
        }
        safely(agentId, "turn_started", () => setState(resumed, "working"));
        handedOver = true;
        await runTurn(resumed, prompt);
        return;
      }
      if (!hasAgent(agentId)) return;
      const stopped = failure instanceof AgentError && failure.code === AgentErrorCode.enum.not_running;
      const message = failure instanceof AgentError ? failure.message : "The agent couldn't be started again. Send the message again to retry.";
      safely(agentId, "turn_failed", () => {
        storeEntries(agentId, [{ type: "turn_ended", stopReason: stopped ? SERVICE_STOP_REASON.stopped : SERVICE_STOP_REASON.error }], neverSent);
        if (stopped) agentState(agentId, undefined, "stopped");
        else agentState(agentId, undefined, "error", { error: { code: AgentErrorCode.enum.agent_failed, message } });
      });
      log("turn_failed", { agentId, resumeError: failure instanceof AgentError ? failure.code : "unknown" });
    } finally {
      if (!handedOver && !unmarked) safely(agentId, "note_not_delivered", neverSent);
    }
  };

  // The labels of the note are read first; the checks, the commandId lookup and the store write stay in one
  // synchronous step after them.
  const send = async (agentId: string, request: SendMessageRequest) => {
    const prepared = await notes().prepare(agentId, request.proposalId);
    return sendNow(agentId, request, prepared);
  };

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
