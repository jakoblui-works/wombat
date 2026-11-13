// What quitting the app, stopping the service from the menu, or restarting the service does to the agents.
// The service keeps the agents running after the app quits, so a quit while any has a process asks whether to stop
// them, or applies the answer remembered with "Don't ask again"; a quit with none stops the service with the app, so
// nothing is left running unseen, and a service kept running is announced. Stopping the service stops every agent, so
// the menu's Stop always asks first, and Restart asks when an agent has a process.
import { agentsWithProcess, type AgentSummary } from "@wombat/shared/api";
import type { QuitAnswer } from "./e2e-switches.ts";
import type { Settings } from "./settings.ts";

/**
 * How many of the service's agents have a process (agentsWithProcess): 0 when no service runs (`agents`
 * gives undefined), undefined when they couldn't be read (so the user is asked rather than told nothing runs).
 */
export const runningCount = async (agents: () => Promise<AgentSummary[] | undefined>, log: (line: string) => void): Promise<number | undefined> => {
  try {
    const list = await agents();
    return list === undefined ? 0 : agentsWithProcess(list).length;
  } catch (error) {
    log(`Wombat couldn't read the service's agents: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};

export type QuitChoice = { answer: QuitAnswer; dontAsk: boolean };

/**
 * The answer a quit applies without asking, or undefined to ask. `askOnQuit` false is "use the remembered answer";
 * settings from before `quitAnswer` have only `askOnQuit` false, which was always a Keep.
 */
const rememberedAnswer = ({ askOnQuit, quitAnswer }: Settings): Settings["quitAnswer"] => (askOnQuit ? undefined : (quitAnswer ?? "leave"));

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
  /**
   * Announces that the service keeps running after the app quits, with `running` agents (undefined: unknown); the quit
   * waits for a returned promise, so the announcement reaches the desktop before the app exits.
   */
  notifyKept: (running: number | undefined) => void | Promise<void>;
  log?: (line: string) => void;
};

/**
 * Whether the app may quit now, after asking (or applying the remembered answer), stopping or announcing as the answer
 * says; false for Cancel. Rejects (no quit) when the stop fails.
 */
export const decideQuit = async ({ settings, updateSettings, idle, agents, ask, stop, notifyKept, log = console.warn }: QuitDeps): Promise<boolean> => {
  // A quit mid-switch would otherwise leave the old service stopped and the new one never started. Each queued
  // operation has its own time limits, so this wait ends.
  await idle();
  const running = await runningCount(agents, log);
  if (running === 0) {
    // Nothing would be left behind but the service itself.
    await stop();
    return true;
  }

  const remembered = rememberedAnswer(settings());
  const { answer, dontAsk } = remembered === undefined ? await ask(running) : { answer: remembered, dontAsk: false };
  if (answer === "cancel") return false;
  // A switch asked for while the question was open would otherwise be cut off, as above.
  await idle();
  if (answer === "stop") await stop();
  // Only once the answer has been carried out: a stop that failed leaves the question on.
  if (dontAsk) {
    try {
      updateSettings((current) => ({ ...current, askOnQuit: false, quitAnswer: answer }));
    } catch (error) {
      log(`Wombat couldn't save "Don't ask again": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (answer === "leave") await notifyKept(running);
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

export type RestartDeps = StopDeps & {
  /** Starts the service for the saved workspace from the code on disk (none runs by then), and connects to it. */
  start: () => Promise<void>;
  /** Not read: Restart is the same in every state. Kept so callers that still pass it compile. */
  incompatible?: () => boolean;
};

/**
 * The page's Restart, in any state: asks as the menu's Stop does when an agent has a process (or the agents can't be
 * read; Cancel leaves everything running and starts nothing), then stops the running service, if any, and starts one
 * from the code on disk. False when cancelled.
 */
export const restartService = async ({ agents, confirm, stop, start, log = console.warn }: RestartDeps): Promise<boolean> => {
  const running = await runningCount(agents, log);
  if (running !== 0 && !(await confirm(running))) return false;
  await stop();
  await start();
  return true;
};
