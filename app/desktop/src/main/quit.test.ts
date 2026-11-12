// The quit decision: when the question is asked, what each answer does, and that a quit waits for a switch in
// progress. The question and the agent list are stubs; the workspace control runs the fake service in a sandbox.
import { API_VERSION } from "@wombat/shared";
import type { AgentSummary } from "@wombat/shared/api";
import { findRunningService } from "@wombat/shared/discovery";
import { isAlive } from "@wombat/shared/process-stat";
import { expect, onTestFinished, test } from "vitest";

import { FAKE_SERVICE_ENTRY, serviceSandbox, type ServiceSandbox } from "../../test/service-sandbox.ts";
import { decideQuit, restartService, stopIfConfirmed, type QuitChoice, type QuitDeps } from "./quit.ts";
import { serviceConnection } from "./service-connection.ts";
import { startService } from "./service-start.ts";
import { loadSettings, saveSettings } from "./settings.ts";
import { workspaceControl } from "./workspace.ts";

const control = (sandbox: ServiceSandbox) =>
  workspaceControl({
    env: sandbox.env,
    settingsFile: sandbox.settingsFile,
    serviceEntry: FAKE_SERVICE_ENTRY,
    chooseFolder: () => Promise.reject(new Error("the folder dialog wasn't expected")),
    confirmRestart: () => Promise.reject(new Error("the restart box wasn't expected")),
    log: () => undefined,
  });

/** A quit with one waiting agent, answering `choice`; counts the questions and stops. */
const quit = (sandbox: ServiceSandbox, choice: QuitChoice, deps: Partial<QuitDeps> = {}) => {
  const workspace = control(sandbox);
  const seen = { asked: 0, stopped: 0 };
  const decided = decideQuit({
    settings: workspace.settings,
    updateSettings: workspace.updateSettings,
    idle: workspace.idle,
    agents: () => Promise.resolve([{ state: "waiting" } as AgentSummary]),
    ask: () => {
      seen.asked += 1;
      return Promise.resolve(choice);
    },
    stop: () => {
      seen.stopped += 1;
      return Promise.resolve();
    },
    log: () => undefined,
    ...deps,
  });
  return { decided, seen };
};

test("Cancel keeps the app running: nothing stopped, the settings as they were", async () => {
  const sandbox = serviceSandbox();
  const { decided, seen } = quit(sandbox, { answer: "cancel", dontAsk: false });

  expect(await decided).toBe(false);
  expect(seen).toEqual({ asked: 1, stopped: 0 });
  expect(loadSettings(sandbox.settingsFile, () => undefined).askOnQuit).toBe(true);
});

test("\"Don't ask again\" saves askOnQuit false, and the next quit asks nothing and leaves the agents", async () => {
  const sandbox = serviceSandbox();
  const first = quit(sandbox, { answer: "leave", dontAsk: true });
  expect(await first.decided).toBe(true);
  expect(loadSettings(sandbox.settingsFile, () => undefined).askOnQuit).toBe(false);

  const second = quit(sandbox, { answer: "stop", dontAsk: false });
  expect(await second.decided).toBe(true);
  expect(second.seen).toEqual({ asked: 0, stopped: 0 });
});

test("a quit during a workspace switch waits for the switch to finish before it looks at the agents", async () => {
  const sandbox = serviceSandbox();
  sandbox.env["FAKE_START_DELAY_MS"] = "300";
  const target = sandbox.workspace("next");
  const workspace = control(sandbox);
  saveSettings(sandbox.settingsFile, { version: 1, workspaces: {}, askOnQuit: true });
  const switching = workspace.switchWorkspace(target);

  let runningWhenRead: string | undefined;
  const quitting = decideQuit({
    settings: workspace.settings,
    updateSettings: workspace.updateSettings,
    idle: workspace.idle,
    agents: async () => {
      runningWhenRead = (await findRunningService(sandbox.discoveryPath))?.workspace;
      return [];
    },
    ask: () => Promise.reject(new Error("the question wasn't expected")),
    stop: () => Promise.reject(new Error("no stop was expected")),
    log: () => undefined,
  });

  expect(await quitting).toBe(true);
  expect(runningWhenRead, "the quit didn't wait for the switch's service").toBe(target);
  await switching;
});

test("Stop: the quit waits until the stop has finished, and only then saves \"Don't ask again\"", async () => {
  const sandbox = serviceSandbox();
  let finishStop = () => undefined as void;
  const stopped = new Promise<void>((resolve) => {
    finishStop = resolve;
  });
  let settled = false;
  const { decided } = quit(sandbox, { answer: "stop", dontAsk: true }, { stop: () => stopped });
  void decided.then(() => {
    settled = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  expect(settled, "the quit went ahead before the stop finished").toBe(false);
  expect(loadSettings(sandbox.settingsFile, () => undefined).askOnQuit).toBe(true);

  finishStop();
  expect(await decided).toBe(true);
  expect(loadSettings(sandbox.settingsFile, () => undefined).askOnQuit).toBe(false);
});

test("a stop that fails fails the quit, and leaves the question on", async () => {
  const sandbox = serviceSandbox();
  const { decided } = quit(sandbox, { answer: "stop", dontAsk: true }, { stop: () => Promise.reject(new Error("the service refused to stop")) });

  await expect(decided).rejects.toThrow("refused to stop");
  expect(loadSettings(sandbox.settingsFile, () => undefined).askOnQuit).toBe(true);
});

test("a discovery file whose service can't be read still gets the question", async () => {
  const sandbox = serviceSandbox();
  const asked: (number | undefined)[] = [];
  const { decided } = quit(sandbox, { answer: "leave", dontAsk: false }, {
    agents: () => Promise.reject(new Error("connection refused")),
    ask: (running) => {
      asked.push(running);
      return Promise.resolve({ answer: "leave", dontAsk: false });
    },
  });

  expect(await decided).toBe(true);
  expect(asked).toEqual([undefined]);
});

test("Stop Service and Agents asks with the running count; Cancel stops nothing", async () => {
  const asked: (number | undefined)[] = [];
  let stops = 0;
  const stoppedIt = await stopIfConfirmed({
    agents: () => Promise.resolve([{ state: "waiting" }, { state: "working" }, { state: "done" }] as AgentSummary[]),
    confirm: (running) => {
      asked.push(running);
      return Promise.resolve(false);
    },
    stop: () => {
      stops += 1;
      return Promise.resolve();
    },
    log: () => undefined,
  });

  expect(stoppedIt).toBe(false);
  expect(asked).toEqual([2]);
  expect(stops).toBe(0);
});

test("a switch asked for while the quit question is open finishes before the answer is carried out", async () => {
  const sandbox = serviceSandbox();
  sandbox.env["FAKE_START_DELAY_MS"] = "300";
  const target = sandbox.workspace("next");
  const workspace = control(sandbox);
  let switching: Promise<unknown> = Promise.resolve();
  let runningWhenStopped: string | undefined;

  const decided = decideQuit({
    settings: workspace.settings,
    updateSettings: workspace.updateSettings,
    idle: workspace.idle,
    agents: () => Promise.resolve([{ state: "working" } as AgentSummary]),
    ask: () => {
      switching = workspace.switchWorkspace(target);
      return Promise.resolve({ answer: "stop", dontAsk: false });
    },
    stop: async () => {
      runningWhenStopped = (await findRunningService(sandbox.discoveryPath))?.workspace;
    },
    log: () => undefined,
  });

  expect(await decided).toBe(true);
  expect(runningWhenStopped, "the stop ran before the switch's service was up").toBe(target);
  await switching;
});

/**
 * The page's Restart over a real connection and workspace control, with a fake service of another API version
 * running. The fake service has no alert stream, so a connection to it gives up (`failed`) after a short while.
 */
const restartFromIncompatible = async (answer: boolean) => {
  const sandbox = serviceSandbox();
  const saved = sandbox.workspace("saved");
  saveSettings(sandbox.settingsFile, { version: 1, workspace: saved, workspaces: {}, askOnQuit: true });
  const old = await startService({
    env: { ...sandbox.env, FAKE_API_VERSION: String(API_VERSION + 1) },
    entry: FAKE_SERVICE_ENTRY,
    workspace: saved,
  });
  const workspace = control(sandbox);
  const connection = serviceConnection({
    discoveryFile: () => sandbox.discoveryPath,
    onState: () => undefined,
    onAlert: () => undefined,
    timing: { firstRetryMs: 10, maxRetryMs: 20, failAfterMs: 200 },
    log: () => undefined,
  });
  onTestFinished(() => connection.close());
  await connection.reconnect(() => Promise.resolve());
  expect(connection.current().state.state).toBe("incompatible");

  const asked: (number | undefined)[] = [];
  const restarted = await restartService({
    incompatible: () => connection.current().state.state === "incompatible",
    agents: () => Promise.resolve([{ state: "waiting" } as AgentSummary]),
    confirm: (running) => {
      asked.push(running);
      return Promise.resolve(answer);
    },
    stop: () => connection.shutdown(() => workspace.shutdown()),
    start: () => connection.reconnect(() => workspace.restart()),
    log: () => undefined,
  });
  return { sandbox, old, asked, restarted, connection, saved };
};

test("Restart on an incompatible service asks, then stops it and its agents and starts the app's own", async () => {
  const { old, asked, restarted, sandbox, saved } = await restartFromIncompatible(true);

  expect(restarted).toBe(true);
  expect(asked).toEqual([1]);
  expect(isAlive(old.pid), "the incompatible service still runs").toBe(false);
  const now = await findRunningService(sandbox.discoveryPath);
  expect(now?.apiVersion).toBe(API_VERSION);
  expect(now?.workspace).toBe(saved);
});

test("Cancel on Restart of an incompatible service leaves it running and starts nothing", async () => {
  const { old, asked, restarted, connection, sandbox } = await restartFromIncompatible(false);

  expect(restarted).toBe(false);
  expect(asked).toEqual([1]);
  expect(isAlive(old.pid)).toBe(true);
  expect(sandbox.starts()).toHaveLength(1);
  expect(connection.current().state.state).toBe("incompatible");
});
