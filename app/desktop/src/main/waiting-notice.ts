// A desktop notification when an agent starts waiting on the user. The desktop shows it outside the app (and may
// keep it in a history), so it says nothing of the agent: fixed text only, and the agent's id stays in main.
import type { AgentSummary, Alert } from "@wombat/shared/api";

/** The notification's whole text; e2e/quit-notifications.e2e.ts checks it holds none of the agent's. */
export const WAITING_NOTICE = { title: "Wombat", body: "An agent is waiting for you" } as const;

/** A notification on screen; `close` takes it away. */
export type ShownNotice = { close: () => void };

export type WaitingNoticeDeps = {
  /** The service's agents, read again for each change. */
  agents: () => Promise<AgentSummary[]>;
  /** Shows `notice`; `onClick` runs when the user clicks it. */
  show: (notice: typeof WAITING_NOTICE, onClick: () => void) => ShownNotice;
  /** Brings the window forward on the agent. */
  openAgent: (agentId: string) => void;
  log?: (line: string) => void;
};

export type WaitingNotices = {
  onAlert: (alert: Alert) => void;
  /**
   * Takes the agents waiting now as already notified. Called on every connect: `/events` never replays, so a change
   * missed while disconnected must not raise a notification late, nor one for an agent already waiting.
   */
  onConnected: () => void;
  /** Settles once every alert and connect so far has been handled. */
  idle: () => Promise<void>;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const waitingNotices = ({ agents, show, openAgent, log = console.warn }: WaitingNoticeDeps): WaitingNotices => {
  // The agents last seen waiting: one notification per turn to waiting, however many alerts it brings.
  const waiting = new Set<string>();
  // At most one notification per agent: a newer one replaces it.
  const shown = new Map<string, ShownNotice>();
  // One step at a time, so an older read never lands after a newer one.
  let chain: Promise<void> = Promise.resolve();
  const then = (step: () => Promise<void> | void): void => {
    chain = chain.then(step);
  };

  const read = async (): Promise<AgentSummary[] | undefined> => {
    try {
      return await agents();
    } catch (error) {
      log(`Wombat couldn't read the agents for its waiting notifications: ${errorText(error)}`);
      return undefined;
    }
  };

  const notify = (agentId: string): void => {
    shown.get(agentId)?.close();
    shown.set(
      agentId,
      show(WAITING_NOTICE, () => {
        openAgent(agentId);
      }),
    );
  };

  const check = async (agentId: string): Promise<void> => {
    const list = await read();
    if (list === undefined) return;
    const agent = list.find(({ id }) => id === agentId);
    if (agent?.state !== "waiting") {
      waiting.delete(agentId);
      return;
    }
    if (waiting.has(agentId)) return;
    waiting.add(agentId);
    notify(agentId);
  };

  const refill = async (): Promise<void> => {
    const list = await read();
    if (list === undefined) return;
    waiting.clear();
    for (const { id, state } of list) if (state === "waiting") waiting.add(id);
  };

  const forget = (agentId: string): void => {
    waiting.delete(agentId);
    shown.get(agentId)?.close();
    shown.delete(agentId);
  };

  return {
    onAlert: (alert) => {
      if (alert.type === "agent_removed") {
        const { agentId } = alert;
        then(() => forget(agentId));
      } else if (alert.type === "agent_changed") {
        const { agentId } = alert;
        then(() => check(agentId));
      }
    },
    onConnected: () => then(refill),
    idle: () => chain,
  };
};
