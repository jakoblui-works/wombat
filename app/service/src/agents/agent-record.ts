import {
  AgentErrorCode,
  LogEntry,
  parseLogEntry,
  PROPOSAL_ALERT,
  SERVICE_STOP_REASON,
  type AgentSummary,
  type Alert,
  type ErrorBody,
} from "@wombat/shared/api";
import { activityOf, commandsOf, configOf, emptyFold, foldEntry, lastMainMessage, sameActivity } from "@wombat/shared/log-fold";

import { canResume } from "../harness/registry.ts";
import { safeName, type Log } from "../log.ts";
import type { NewLogEntry, Store } from "../store/store.ts";
import type { AgentProcess, AgentProcessDeps } from "./agent-process.ts";
import { readBranch } from "./branch.ts";
import type { Config } from "./config.ts";
import { notRunning } from "./errors.ts";
import { excerpt, keepForExcerpt } from "./excerpt.ts";
import { isHidden, mayRecord, next, recordsAgent, stateOnClose, writesTurnEndOnClose } from "./phase.ts";
import { pendingPermissions } from "./permissions.ts";
import { now, type Proc } from "./proc.ts";

/** A change committed to the store, told to listeners (the alert stream) once it can be read. */
type WithoutDbId<T> = T extends unknown ? Omit<T, "dbId"> : never;
export type Committed = WithoutDbId<Alert>;

type ErrorDetail = ErrorBody["error"];
export type StateDetails = { error?: ErrorDetail; lastUserAt?: string };

export type AgentRecordDeps = {
  store: Store;
  log: Log;
  /** Whether the agent has a live process: the summary's `hasProcess`. */
  hasProcess: AgentProcess["hasProcess"];
  isCurrent: AgentProcess["isCurrent"];
  shuttingDown: () => boolean;
  appendConfig: Config["appendConfig"];
};

type HeldUpdate = { sessionId: string; update: unknown };

/** The agents' summaries and logs as stored, and the listeners told of each change once it can be read. */
export const createAgentRecord = (deps: AgentRecordDeps) => {
  const { store, log, hasProcess, isCurrent, shuttingDown, appendConfig } = deps;
  const listeners = new Set<(event: Committed) => void>();
  const summaries = new Map(store.listAgents().map((agent) => [agent.id, agent]));
  // commandId → seq of its user_message, per agent; loaded from the store on first use.
  const commandIds = new Map<string, Map<string, number>>();
  const skippedUpdates = new WeakMap<Proc, number>();
  // Updates that arrived before the agent's summary was stored, per process.
  const heldUpdates = new WeakMap<Proc, HeldUpdate[]>();

  const emit = (event: Committed) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        const subject = event.type === PROPOSAL_ALERT ? { proposalId: event.proposalId } : { agentId: event.agentId };
        log("listener_failed", { ...subject, seq: event.seq, type: event.type });
      }
    }
  };

  const onCommitted = (listener: (event: Committed) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const summaryOf = (agentId: string) => summaries.get(agentId);

  const hasAgent = (agentId: string) => summaries.has(agentId);

  /** Drops what is kept in memory of a deleted agent. */
  const forget = (agentId: string) => {
    summaries.delete(agentId);
    commandIds.delete(agentId);
  };

  /**
   * Stores the summary with `hasProcess` derived from the live processes, its only source. `cache` stays on the
   * in-memory summary and is never stored.
   */
  const putSummary = (fields: Omit<AgentSummary, "hasProcess">, type: "agent_added" | "agent_changed") => {
    const summary: AgentSummary = { ...fields, hasProcess: hasProcess(fields.id) };
    const stored = { ...summary };
    delete stored.cache;
    const seq = store.putAgent(stored);
    summaries.set(summary.id, summary);
    emit({ seq, agentId: summary.id, type });
    return summary;
  };

  /**
   * Stores the entries and tells listeners; every entry of the agent's log is written through here. Only for an agent
   * without a process (a message that resumes it, the end of a turn whose resume failed); otherwise `appendLog`.
   */
  const storeEntries = (agentId: string, entries: NewLogEntry[]) => {
    const stored = entries.map((entry) => ({ ...entry, at: entry.at ?? now() }));
    const seqs = store.append(agentId, stored);
    const last = seqs.at(-1);
    if (last !== undefined) emit({ seq: last, agentId, type: "log" });
    return { stored, seqs };
  };

  /** Stores the entries (`storeEntries`) and folds each one as stored. */
  const appendLog = (proc: Proc, entries: NewLogEntry[]) => {
    const { agentId } = proc;
    if (!proc.fold) throw new Error(`Can't log for agent ${agentId} before its session started.`);
    const { stored, seqs } = storeEntries(agentId, entries);
    let fold = proc.fold;
    for (const [index, entry] of stored.entries()) {
      if (entry.type === "user_message") fold = emptyFold(proc.sessionId);
      foldEntry(fold, { ...entry, seq: seqs[index] ?? 0, agentId }, { keepText: keepForExcerpt });
    }
    proc.fold = fold;
    proc.config = configOf(fold) ?? proc.config;
    proc.commands = commandsOf(fold) ?? proc.commands;
    return seqs;
  };

  /** The summary's activity: what the turn's fold says while the agent works, else none. */
  const activityNow = (proc: Proc | undefined, state: AgentSummary["state"]) => (state === "working" && proc?.fold ? activityOf(proc.fold) : null);

  /**
   * `current` with what the turn's fold says now: the activity for `state`, and lastText. With no main-session message
   * in the fold (a new turn), the stored lastText stays.
   */
  const fromFold = (proc: Proc | undefined, current: AgentSummary, state: AgentSummary["state"]): AgentSummary => {
    const next: AgentSummary = { ...current, activity: activityNow(proc, state) };
    const message = proc?.fold && lastMainMessage(proc.fold);
    if (message !== undefined) {
      const text = excerpt(message);
      delete next.lastText;
      if (text !== "") next.lastText = text;
    }
    return next;
  };

  /**
   * After a stored update: writes the summary when its activity changed (by `sameActivity`), taking the fold's lastText
   * along. A change to lastText alone writes nothing; it is current at least at each turn's end.
   */
  const refreshFromFold = (proc: Proc) => {
    const current = summaries.get(proc.agentId);
    if (!current) return;
    const next = fromFold(proc, current, current.state);
    if (sameActivity(next.activity ?? null, current.activity ?? null)) return;
    putSummary(next, "agent_changed");
  };

  const handleUpdate = (proc: Proc, sessionId: string, update: unknown) => {
    if (!recordsAgent(proc.phase)) {
      const held = heldUpdates.get(proc) ?? [];
      held.push({ sessionId, update });
      heldUpdates.set(proc, held);
      return;
    }
    const { agentId } = proc;
    const kind = safeName((update as { sessionUpdate?: unknown } | null)?.sessionUpdate);
    if (isHidden(proc.phase)) {
      log("update_hidden", { agentId, kind });
      return;
    }
    let entry: LogEntry | undefined;
    try {
      entry = parseLogEntry({ type: "session_update", seq: 0, agentId, at: now(), sessionId, update });
    } catch {
      log("update_invalid", { agentId, kind });
      return;
    }
    if (entry?.type !== "session_update") {
      const skipped = (skippedUpdates.get(proc) ?? 0) + 1;
      skippedUpdates.set(proc, skipped);
      log("update_skipped", { agentId, kind, count: skipped });
      return;
    }
    const parsed = entry.update;
    safely(agentId, "session_update", () => {
      appendLog(proc, [{ type: "session_update", sessionId, update: parsed }]);
      if (parsed.sessionUpdate === "session_info_update" && typeof parsed.title === "string") {
        const current = summaryOf(agentId);
        if (current) putSummary({ ...current, title: parsed.title, lastActivityAt: now() }, "agent_changed");
      }
      refreshFromFold(proc);
    });
  };

  const releaseHeld = (proc: Proc) => {
    const held = heldUpdates.get(proc) ?? [];
    heldUpdates.delete(proc);
    for (const { sessionId, update } of held) handleUpdate(proc, sessionId, update);
  };

  /**
   * Records the session `proc` opened: `write` stores what the caller keeps of it, then the session's config options
   * and the updates held meanwhile are stored. Throws `notRunning` when the process may no longer be recorded.
   */
  const recordSession = <T>(proc: Proc, configOptions: unknown[], resumable: boolean, write: () => T): T => {
    if (shuttingDown() || !mayRecord(proc.phase) || !isCurrent(proc)) throw notRunning(resumable);
    const written = write();
    proc.phase = next(proc.phase, { type: "recorded" });
    if (configOptions.length > 0) {
      safely(proc.agentId, "config_option_update", () => {
        appendConfig(proc, configOptions);
      });
    }
    releaseHeld(proc);
    return written;
  };

  /**
   * Writes the agent's state with its pendingPermissions derived anew and its activity and lastText from its fold
   * (`fromFold`), so every change to the open requests is followed by one of these. `agentState` is for an agent
   * without a process (no requests, no activity).
   */
  const setState = (proc: Proc, state: AgentSummary["state"], details: StateDetails = {}) => {
    agentState(proc.agentId, proc, state, details);
  };

  const agentState = (
    agentId: string,
    proc: Proc | undefined,
    state: AgentSummary["state"],
    { error, lastUserAt }: StateDetails = {},
  ) => {
    const current = summaries.get(agentId);
    if (!current) return;
    const next: AgentSummary = {
      ...fromFold(proc, current, state),
      state,
      lastActivityAt: now(),
      pendingPermissions: pendingPermissions(proc),
    };
    delete next.error;
    if (error) next.error = error;
    if (lastUserAt !== undefined) next.lastUserAt = lastUserAt;
    putSummary(next, "agent_changed");
    log("agent_state", { agentId, state });
  };

  /** Reads the branch of the agent's folder; undefined (and one log line) when that fails. */
  const branchOf = async (agentId: string, cwd: string) => {
    try {
      return await readBranch(cwd);
    } catch {
      log("branch_unreadable", { agentId });
      return undefined;
    }
  };

  /** Re-reads the agent's branch and writes it when it changed, unless the agent was removed meanwhile. */
  const refreshBranch = async (agentId: string, cwd: string) => {
    const branch = await branchOf(agentId, cwd);
    const current = summaries.get(agentId);
    if (!current || current.branch === branch) return;
    const next: AgentSummary = { ...current };
    delete next.branch;
    if (branch !== undefined) next.branch = branch;
    safely(agentId, "branch", () => putSummary(next, "agent_changed"));
  };

  /** For writes driven by the agent rather than a caller: a failure is logged, not thrown into the ACP layer. */
  const safely = (agentId: string, what: string, write: () => void) => {
    try {
      write();
    } catch {
      log("store_write_failed", { agentId, what });
    }
  };

  /** What the log and the summary get once the agent's process closed. */
  const recordClosed: AgentProcessDeps["closed"] = (proc, closing, code, signal) => {
    const { agentId } = proc;
    // A turn the process ended under gets its end in the log too; a removed agent has no log left.
    if (writesTurnEndOnClose(closing)) {
      safely(agentId, "turn_stopped", () => appendLog(proc, [{ type: "turn_ended", stopReason: SERVICE_STOP_REASON.stopped }]));
    }
    const state = stateOnClose(closing);
    if (state === "stopped") {
      safely(agentId, "stopped", () => setState(proc, "stopped"));
    } else if (state === "error") {
      const how = code === null ? `was killed (${signal ?? "unknown signal"})` : `exited with code ${code}`;
      safely(agentId, "exited", () =>
        setState(proc, "error", {
          error: {
            code: AgentErrorCode.enum.agent_failed,
            message:
              `The agent process ${how} unexpectedly. ` +
              (canResume(proc.harness)
                ? "Send a message to start it again; its history is kept."
                : "Start a new agent to continue; this one's history is kept."),
          },
        }),
      );
    }
  };

  const knownCommands = (agentId: string) => {
    let known = commandIds.get(agentId);
    if (!known) {
      known = new Map();
      for (const entry of store.readLog(agentId).entries) {
        if (entry.type === "user_message" && entry.commandId !== undefined) known.set(entry.commandId, entry.seq);
      }
      commandIds.set(agentId, known);
    }
    return known;
  };

  const markStored = () => {
    // Agents stored by an earlier run have no process any more, so no open requests either; an error agent may still
    // be stored as having one (a failed turn) by a service that died.
    let marked = 0;
    for (const agent of [...summaries.values()]) {
      const live = agent.state === "working" || agent.state === "waiting" || agent.state === "done";
      if (live || agent.pendingPermissions.length > 0 || agent.hasProcess) {
        const state = live ? "stopped" : agent.state;
        putSummary({ ...agent, state, pendingPermissions: pendingPermissions(undefined), activity: null }, "agent_changed");
      }
      if (live) {
        log("agent_state", { agentId: agent.id, state: "stopped" });
        marked += 1;
      }
    }
    log("agents_loaded", { count: summaries.size, markedStopped: marked });
  };

  return {
    emit,
    onCommitted,
    summaryOf,
    hasAgent,
    forget,
    putSummary,
    storeEntries,
    appendLog,
    setState,
    agentState,
    branchOf,
    refreshBranch,
    safely,
    knownCommands,
    handleUpdate,
    recordSession,
    recordClosed,
    markStored,
  };
};

export type AgentRecord = ReturnType<typeof createAgentRecord>;
