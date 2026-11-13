// The waiting notification: one per turn to waiting, fixed text, one on screen per agent, and a click that opens
// the agent. The agent list is a stub standing in for the service.
import type { AgentSummary, Alert } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { WAITING_NOTICE, waitingNotices } from "./waiting-notice.ts";

type State = AgentSummary["state"];

/** A notifier over agents whose states the test sets; records what it shows, closes and opens. */
const notifier = (initial: Record<string, State> = {}) => {
  const states = new Map<string, State>(Object.entries(initial));
  let failing = false;
  let inApp = false;
  const shown: { notice: typeof WAITING_NOTICE; click: () => void; closed: boolean }[] = [];
  const opened: string[] = [];
  const notices = waitingNotices({
    agents: () =>
      failing
        ? Promise.reject(new Error("the service didn't answer"))
        : Promise.resolve([...states].map(([id, state]) => ({ id, state }) as AgentSummary)),
    show: (notice, click) => {
      const entry = { notice, click, closed: false };
      shown.push(entry);
      return {
        close: () => {
          entry.closed = true;
        },
      };
    },
    openAgent: (agentId) => opened.push(agentId),
    focused: () => inApp,
    log: () => undefined,
  });
  let seq = 0;
  const change = async (agentId: string, state: State) => {
    states.set(agentId, state);
    notices.onAlert({ seq: ++seq, dbId: "db-1", type: "agent_changed", agentId } satisfies Alert);
    await notices.idle();
  };
  const remove = async (agentId: string) => {
    states.delete(agentId);
    notices.onAlert({ seq: ++seq, dbId: "db-1", type: "agent_removed", agentId } satisfies Alert);
    await notices.idle();
  };
  /** The agent each notification opens when clicked (the only place its id is). */
  const agentsShown = () =>
    shown.map(({ click }) => {
      const before = opened.length;
      click();
      return opened.splice(before).join();
    });
  const connected = async () => {
    notices.onConnected();
    await notices.idle();
  };
  return {
    change,
    remove,
    connected,
    shown,
    opened,
    agentsShown,
    setState: (agentId: string, state: State) => states.set(agentId, state),
    fail: (on: boolean) => {
      failing = on;
    },
    focus: (on: boolean) => {
      inApp = on;
    },
  };
};

test("two changes while an agent stays waiting raise one notification, with the fixed text", async () => {
  const { change, shown } = notifier();
  await change("agent-1", "waiting");
  await change("agent-1", "waiting");

  expect(shown.map(({ notice }) => notice)).toEqual([WAITING_NOTICE]);
});

test("waiting, working, then waiting again raises a second notification, which replaces the first", async () => {
  const { change, shown } = notifier();
  await change("agent-1", "waiting");
  await change("agent-1", "working");
  await change("agent-1", "waiting");

  expect(shown.map(({ closed }) => closed)).toEqual([true, false]);
});
