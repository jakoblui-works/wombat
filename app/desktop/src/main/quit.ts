// What quitting the app, or stopping the service from the menu, does to the agents. The service keeps them running
// after the app quits, so a quit while any are running asks whether to stop them; leaving them running is what
// happens when the question is off. Stopping the service stops every agent, so it always asks first.
import type { AgentSummary } from "@wombat/shared/api";
import type { QuitAnswer } from "./e2e-switches.ts";
import type { Settings } from "./settings.ts";

/** The one rule for which agents the quit and stop questions are about. */
export const isRunningAgent = ({ state }: Pick<AgentSummary, "state">): boolean => state === "working" || state === "waiting";

/**
 * How many of the service's agents are running: 0 when no service runs (`agents` gives undefined), undefined when
 * they couldn't be read (so the user is asked rather than told nothing runs).
 */
const runningCount = async (agents: () => Promise<AgentSummary[] | undefined>, log: (line: string) => void): Promise<number | undefined> => {
  try {
    const list = await agents();
    return list === undefined ? 0 : list.filter(isRunningAgent).length;
  } catch (error) {
    log(`Wombat couldn't read the service's agents: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};

export type QuitChoice = { answer: QuitAnswer; dontAsk: boolean };

export type QuitDeps = {
  settings: () => Settings;
  updateSettings: (change: (current: Settings) => Settings) => void;
  /** Settles once the workspace control's queue has (a start or switch in progress finished). */
  idle: () => Promise<void>;
  /** The service's agents; undefined when no service runs; rejects when a service may run but can't be read. */
  agents: () => Promise<AgentSummary[] | undefined>;
  /** The question; `running` is undefined when the agents couldn't be read. */
  ask: (running: number | undefined) => Promise<QuitChoice>;
  /** Stops the service and its agents; resolves once they're stopped. */
  stop: () => Promise<void>;
  log?: (line: string) => void;
};

/**
 * Whether the app may quit now, after asking and stopping as the answer says; false for Cancel. Rejects (no quit)
 * when the stop fails.
 */
export const decideQuit = async ({ settings, updateSettings, idle, agents, ask, stop, log = console.warn }: QuitDeps): Promise<boolean> => {
  // A quit mid-switch would otherwise leave the old service stopped and the new one never started. Each queued
  // operation has its own time limits, so this wait ends.
  await idle();
  if (!settings().askOnQuit) return true;
  const running = await runningCount(agents, log);
  if (running === 0) return true;

  const { answer, dontAsk } = await ask(running);
  if (answer === "cancel") return false;
  if (answer === "stop") await stop();
  // Only once the answer has been carried out: a stop that failed leaves the question on.
  if (dontAsk) {
    try {
      updateSettings((current) => ({ ...current, askOnQuit: false }));
    } catch (error) {
      log(`Wombat couldn't save "Don't ask again": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return true;
};

export type StopDeps = {
  agents: () => Promise<AgentSummary[] | undefined>;
  /** "Stop the service and its N agents?"; true for Stop. `running` is undefined when the agents couldn't be read. */
  confirm: (running: number | undefined) => Promise<boolean>;
  stop: () => Promise<void>;
  log?: (line: string) => void;
};

/** The menu's "Stop Service and Agents": asks, then stops; false when cancelled. */
export const stopIfConfirmed = async ({ agents, confirm, stop, log = console.warn }: StopDeps): Promise<boolean> => {
  if (!(await confirm(await runningCount(agents, log)))) return false;
  await stop();
  return true;
};
