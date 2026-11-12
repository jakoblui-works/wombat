// What quitting does to the service and its agents, and that a waiting agent raises a notification. Every launch runs
// in its own sandbox (app-fixtures.ts); the quit question's answer comes from WOMBAT_E2E_QUIT_ANSWER, and notifications
// are recorded in main (E2E_NOTIFICATIONS), never shown. What reaches Electron's Notification is checked in
// src/main/notice-sink.test.ts.
import {
  agentSummary,
  E2E_NOTIFICATIONS,
  expect,
  isAlive,
  startWaitingAgent,
  SWITCH,
  test,
  waitForConnection,
  waitUntil,
  WAIT_MS,
  type Sandbox,
} from "./app-fixtures.ts";

// Invented prompt text for the waiting agent.
const PROMPT = "Tidy the opening hours on the Juniper Lane bakery page";

type Running = { servicePid: number; agentId: string; agentPids: number[] };

/** The app connected, with one fake agent waiting on a permission answer. */
const appWithWaitingAgent = async (sandbox: Sandbox, env: Record<string, string>) => {
  const launched = await sandbox.launch({ env });
  await waitForConnection(launched.page, "connected");
  const file = await sandbox.waitForService();
  const agentId = await startWaitingAgent(sandbox, PROMPT);
  const running: Running = { servicePid: file.pid, agentId, agentPids: sandbox.agentPids() };
  expect(running.agentPids.length).toBeGreaterThan(0);
  return { launched, running };
};

const expectStillRunning = async (sandbox: Sandbox, { servicePid, agentId, agentPids }: Running): Promise<void> => {
  expect(isAlive(servicePid), "the service stopped").toBe(true);
  expect(agentPids.filter((pid) => !isAlive(pid)), "an agent process stopped").toEqual([]);
  expect((await agentSummary(sandbox, agentId))?.state, "the agent is no longer waiting").toBe("waiting");
};

test.describe("T7: quitting with an agent waiting", () => {
  test("answer Stop: the service and its agents are gone", async ({ sandbox }) => {
    const { launched, running } = await appWithWaitingAgent(sandbox, { [SWITCH.quitAnswer]: "stop" });
    await launched.quit();
    await launched.exited();
    await waitUntil("the service to exit", WAIT_MS, () => (isAlive(running.servicePid) ? undefined : true));
    expect(running.agentPids.filter(isAlive), "agents outlived the service").toEqual([]);
  });

  test("answer Leave: the service and the agent keep running", async ({ sandbox }) => {
    const { launched, running } = await appWithWaitingAgent(sandbox, { [SWITCH.quitAnswer]: "leave" });
    await launched.quit();
    await launched.exited();
    await expectStillRunning(sandbox, running);
  });

  // The answer would be Cancel: if the question were asked anyway, the app wouldn't quit.
  test("with askOnQuit false there is no question: the app quits and leaves the agents running", async ({ sandbox }) => {
    sandbox.writeSettings({ version: 1, workspace: sandbox.workspace, workspaces: {}, askOnQuit: false });
    const { launched, running } = await appWithWaitingAgent(sandbox, { [SWITCH.quitAnswer]: "cancel" });
    await launched.quit();
    await launched.exited();
    await expectStillRunning(sandbox, running);
  });
});

// The running app's whole path from the service's alert to the sink: the unit tests cover each part, not the wiring.
test("an agent that starts waiting raises a notification", async ({ sandbox }) => {
  const { launched } = await appWithWaitingAgent(sandbox, {});
  const recorded = await waitUntil("a recorded notification", WAIT_MS, async () => {
    const notes = await launched.app.evaluate((_electron, key) => (globalThis as Record<string, unknown>)[key], E2E_NOTIFICATIONS);
    return Array.isArray(notes) && notes.length > 0 ? notes : undefined;
  });
  expect(recorded).toEqual([{ title: "Wombat", body: "An agent is waiting for you" }]);
});
