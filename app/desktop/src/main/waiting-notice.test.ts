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

test("an agent that stops waiting has its notification closed", async () => {
  const { change, shown } = notifier();
  await change("agent-1", "waiting");
  await change("agent-1", "working");

  expect(shown.map(({ closed }) => closed)).toEqual([true]);
});

test("a click on the notification opens its agent", async () => {
  const { change, shown, opened } = notifier();
  await change("agent-1", "waiting");
  shown[0]?.click();

  expect(opened).toEqual(["agent-1"]);
});

test("two agents waiting at once get a notification each", async () => {
  const { change, shown, agentsShown } = notifier();
  await change("agent-1", "waiting");
  await change("agent-2", "waiting");

  expect(agentsShown()).toEqual(["agent-1", "agent-2"]);
  expect(shown.map(({ closed }) => closed)).toEqual([false, false]);
});

test("a removed agent's notification is closed, and an agent by that id waiting later is notified again", async () => {
  const { change, remove, shown } = notifier();
  await change("agent-1", "waiting");
  await remove("agent-1");
  expect(shown[0]?.closed).toBe(true);

  await change("agent-1", "waiting");
  expect(shown).toHaveLength(2);
});

test("a failed read of the agents changes nothing: no notification, and the next read decides", async () => {
  const { change, fail, shown } = notifier();
  await change("agent-1", "waiting");
  fail(true);
  await change("agent-1", "working");
  fail(false);
  await change("agent-1", "waiting");

  expect(shown, "the failed read counted as a turn to working").toHaveLength(1);
});

test("on connect, agents already waiting count as notified; one that turned waiting while disconnected isn't notified late", async () => {
  const { change, connected, setState, shown, agentsShown } = notifier({ "agent-1": "waiting" });
  await connected();
  await change("agent-1", "waiting");
  expect(shown, "an agent waiting before the connect was notified").toEqual([]);

  setState("agent-2", "waiting");
  await connected();
  await change("agent-2", "waiting");
  expect(shown).toEqual([]);

  // Back to working while disconnected, then waiting again: a new turn.
  setState("agent-1", "working");
  await connected();
  await change("agent-1", "waiting");
  expect(agentsShown()).toEqual(["agent-1"]);
});

test("on connect, notices for agents that stopped waiting while disconnected are closed", async () => {
  const { change, connected, setState, shown } = notifier();
  await change("agent-1", "waiting");
  await change("agent-2", "waiting");
  await change("agent-3", "waiting");

  setState("agent-1", "working");
  setState("agent-2", "done");
  await connected();
  expect(shown.map(({ closed }) => closed)).toEqual([true, true, false]);

  // Forgotten, so a new turn to waiting is a new notice.
  await change("agent-1", "waiting");
  expect(shown).toHaveLength(4);
});

test("no notification while the user is in the app, and none late once they leave; the next turn to waiting notifies", async () => {
  const n = notifier({ a: "working" });
  n.focus(true);
  await n.change("a", "waiting");
  expect(n.shown).toEqual([]);

  n.focus(false);
  await n.change("a", "waiting");
  expect(n.shown).toEqual([]);

  await n.change("a", "working");
  await n.change("a", "waiting");
  expect(n.agentsShown()).toEqual(["a"]);
});
