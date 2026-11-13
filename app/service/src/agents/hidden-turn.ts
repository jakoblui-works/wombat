import { AgentErrorCode, type ContextBreakdown } from "@wombat/shared/api";

import type { CacheState, Harness } from "../harness/harness.ts";
import { canResume, findHarness } from "../harness/registry.ts";
import type { Log } from "../log.ts";
import type { AgentRecord } from "./agent-record.ts";
import { contextGate } from "./context-gate.ts";
import { AgentError, busy, notRunning, requireAgent, rpcCode, rpcMessage } from "./errors.ts";
import { endingByService, isHidden, isTurnOpen, next, recordsAgent } from "./phase.ts";
import type { Proc } from "./proc.ts";

/** Why a message or config change is refused while the agent reports its context. */
export const HIDDEN_BUSY =
  "The agent is reporting its context. Try again in a moment; if it stays busy, stop the agent, then try again: it keeps its conversation.";

/** A harness waiting for one of the agent's extension notifications (see `ContextAgent.nextExt`). */
type ExtWaiter = { method: string; match: (params: unknown) => boolean; resolve: (params: unknown) => void; reject: (error: Error) => void };

const sameCache = (a: CacheState | null, b: CacheState | null) =>
  a === b || (a !== null && b !== null && a.ttlSeconds === b.ttlSeconds && a.lastRequestAt === b.lastRequestAt);

export type HiddenTurnDeps = {
  log: Log;
  harnesses: readonly Harness[];
  /** Throws once the service is shutting down. */
  assertOpen: () => void;
  summaryOf: AgentRecord["summaryOf"];
  putSummary: AgentRecord["putSummary"];
  safely: AgentRecord["safely"];
  /** The agent's process, resumed first when it has none. */
  ensureRunning: (agentId: string) => Promise<Proc>;
  /** Whether a message waits for the agent's resume to run its turn. */
  hasPendingTurn: (agentId: string) => boolean;
};

/** The agents' context reports, made by hidden turns, and the extension notifications their harnesses read. */
export const createHiddenTurn = ({ log, harnesses, assertOpen, summaryOf, putSummary, safely, ensureRunning, hasPendingTurn }: HiddenTurnDeps) => {
  // Harnesses waiting for extension notifications, per process; rejected when the process ends.
  const extWaiters = new WeakMap<Proc, Set<ExtWaiter>>();
  // The context report each process is making, which every request meanwhile shares; dropped once it settles.
  const contextReports = new WeakMap<Proc, Promise<ContextBreakdown>>();

  const waitersOf = (proc: Proc) => {
    let waiters = extWaiters.get(proc);
    if (!waiters) {
      waiters = new Set();
      extWaiters.set(proc, waiters);
    }
    return waiters;
  };

  /**
   * An extension notification: the harness reads it (a cache state it reports is kept on the proc and, when it
   * changed, written to the in-memory summary), then any harness waiting for it gets its params.
   */
  const handleExt = (proc: Proc, method: string, params: unknown) => {
    const { agentId } = proc;
    let result: ReturnType<NonNullable<Harness["extNotification"]>>;
    try {
      result = proc.harness.extNotification?.(method, params, proc.cache);
    } catch {
      log("ext_invalid", { agentId });
    }
    const cache = result?.cache;
    if (cache !== undefined && !sameCache(cache, proc.cache)) {
      proc.cache = cache;
      const current = summaryOf(agentId);
      if (recordsAgent(proc.phase) && current) safely(agentId, "cache", () => putSummary({ ...current, cache }, "agent_changed"));
    }
    const waiters = extWaiters.get(proc) ?? new Set<ExtWaiter>();
    for (const waiter of [...waiters]) {
      let matched = false;
      try {
        matched = waiter.method === method && waiter.match(params);
      } catch {
        // A match that throws is no match.
      }
      if (!matched) continue;
      waiters.delete(waiter);
      waiter.resolve(params);
    }
  };

  /** `ContextAgent.nextExt` for the agent: the params of its next notification `method` that `match` accepts. */
  const nextExt = (proc: Proc, method: string, match: (params: unknown) => boolean, timeoutMs: number) =>
    new Promise<unknown>((resolve, reject) => {
      const waiters = waitersOf(proc);
      const waiter: ExtWaiter = {
        method,
        match,
        resolve: (params) => {
          clearTimeout(timer);
          resolve(params);
        },
        reject: (error) => {
          clearTimeout(timer);
          waiters.delete(waiter);
          reject(error);
        },
      };
      const timer = setTimeout(
        () => waiter.reject(new Error(`The agent sent no report within ${timeoutMs / 1000} s.`)),
        timeoutMs,
      );
      waiters.add(waiter);
    });

  const rejectExtWaiters = (proc: Proc) => {
    for (const waiter of [...(extWaiters.get(proc) ?? [])]) waiter.reject(new Error("The agent's process ended."));
  };

  /**
   * The agent's context breakdown, by a hidden turn its harness drives: nothing of the turn reaches the log, the
   * summary or the events, and nothing else runs on the agent meanwhile. A request while one runs gets its report;
   * refused while a turn runs (`busy`), and `unsupported` while the agent's latest command list lacks its harness's
   * `contextCommand`. A failure answers `agent_error` with the agent's message, and the agent stays as it was. An agent
   * without a process is resumed first (`ensureRunning`).
   */
  const contextBreakdown = async (agentId: string): Promise<ContextBreakdown> => {
    assertOpen();
    const summary = requireAgent(agentId, summaryOf);
    const harness = findHarness(summary.harness, harnesses);
    const report = harness?.contextBreakdown;
    if (harness === undefined || report === undefined) {
      throw new AgentError(
        AgentErrorCode.enum.unsupported,
        `${harness?.name ?? summary.harness} doesn't report its context. Use an agent whose harness offers the context feature.`,
      );
    }
    const turnBusy = () => busy("The agent is working on a turn; its context is available once it is idle. Try again then.");
    if (hasPendingTurn(agentId)) throw turnBusy();
    // Asking an agent without a process starts it, as a message does.
    const proc = await ensureRunning(agentId);
    // A message may have come while the agent was being resumed.
    const command = harness.contextCommand;
    const reporting = contextReports.get(proc);
    const gate = contextGate({
      reporting: reporting !== undefined,
      command,
      commands: proc.commands,
      turn: isTurnOpen(proc.phase) || hasPendingTurn(agentId),
      hidden: isHidden(proc.phase),
    });
    if (gate === "join" && reporting) return reporting;
    if (gate === "unsupported") {
      throw new AgentError(
        AgentErrorCode.enum.unsupported,
        `This agent doesn't list /${command ?? ""} among its commands, so it can't report its context. Try again once ` +
          `it has listed its commands; if it never offers /${command ?? ""}, update ${harness.name}.`,
      );
    }
    if (gate === "turn_busy") throw turnBusy();
    if (gate === "hidden_busy") throw busy(HIDDEN_BUSY);
    const running = hiddenReport(proc, report);
    contextReports.set(proc, running);
    const settled = () => {
      if (contextReports.get(proc) === running) contextReports.delete(proc);
    };
    running.then(settled, settled);
    return running;
  };

  /** Runs the harness's `report` as a hidden turn on `proc` (`contextBreakdown`), which has checked it may. */
  const hiddenReport = async (proc: Proc, report: NonNullable<Harness["contextBreakdown"]>): Promise<ContextBreakdown> => {
    const { agentId } = proc;
    proc.phase = next(proc.phase, { type: "hiddenStarted" });
    // The hidden turn's prompts still unanswered: it stays hidden until the agent has answered them all, even when
    // the harness gave up on one earlier.
    let open = 0;
    let ended = false;
    const unhide = () => {
      if (ended && open === 0) proc.phase = next(proc.phase, { type: "hiddenEnded" });
    };
    try {
      return await report({
        prompt: (text) => {
          open += 1;
          return proc.acp.prompt(proc.sessionId, text).finally(() => {
            open -= 1;
            unhide();
          });
        },
        nextExt: (method, match, timeoutMs) => nextExt(proc, method, match, timeoutMs),
        home: proc.home,
      });
    } catch (error) {
      if (proc.acp.isClosed() || endingByService(proc.phase)) throw notRunning(canResume(proc.harness));
      const code = rpcCode(error);
      log("context_failed", { agentId, code: code ?? -1 });
      const said = rpcMessage(error);
      // An ACP error is the agent's, and may pass: try again. Anything else is the harness's, whose message names the
      // remedy.
      const next =
        code === undefined
          ? (said ?? "")
          : `Try again.${said === undefined || said === "" ? "" : ` The agent said: ${said}`}`;
      throw new AgentError(
        AgentErrorCode.enum.agent_error,
        `The agent couldn't report its context${code === undefined ? "" : ` (ACP error ${code})`}; it keeps running as it was.${next === "" ? "" : ` ${next}`}`,
      );
    } finally {
      ended = true;
      // A prompt the harness no longer waits for is cancelled; the turn stays hidden until the agent answers it.
      if (open > 0) {
        log("context_cancelled", { agentId });
        void proc.acp.cancel(proc.sessionId).catch(() => undefined);
      }
      unhide();
    }
  };

  return { contextBreakdown, handleExt, rejectExtWaiters };
};
