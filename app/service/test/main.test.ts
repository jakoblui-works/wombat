// The service as a process: spawned for real, found through the discovery file as the app will find it (parsed
// with the shared schema, so the writer can't drift from the reader), one instance per runtime dir even when two
// start at once, and ending cleanly on SIGTERM or POST /shutdown. Every spawned service gets recording fakes of
// systemd-run and systemctl as its whole PATH, so no run can ever stop the real wombat-agents.slice.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { API_VERSION } from "@wombat/shared";
import { VersionResponse } from "@wombat/shared/api";
import { codeIdOf } from "@wombat/shared/code-id";
import { DiscoveryFile } from "@wombat/shared/discovery";
import { startTimeOf } from "@wombat/shared/process-stat";
import { expect, onTestFinished, test } from "vitest";

import { openStore } from "../src/store/store.ts";
import { fakeSystemd, killedUnits, type FakeSystemd } from "./fake-systemd.ts";
import { isAlive, REPO, SERVICE_SLICE, TEST_TIMEOUT_MS, WAIT_MS, waitFor } from "./manager-fixtures.ts";
import { APP_ORIGIN, rawRequest } from "./server-fixtures.ts";

const SERVICE_DIR = join(import.meta.dirname, "..");
const MAIN = join(SERVICE_DIR, "src", "main.ts");
const ENTRY = join(import.meta.dirname, "service-entry.ts");

type Exit = { code: number | null; signal: NodeJS.Signals | null };

type Spawned = {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  /** Resolves when the process exits; fails after WAIT_MS. */
  exited: () => Promise<Exit>;
};

const spawnService = (script: string, env: NodeJS.ProcessEnv): Spawned => {
  const child = spawn(process.execPath, [script], { cwd: SERVICE_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const exit = new Promise<Exit>((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  onTestFinished(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
    exited: () =>
      Promise.race([
        exit,
        new Promise<Exit>((_, reject) =>
          setTimeout(() => reject(new Error(`timed out waiting for ${script} to exit; stderr:\n${stderr}`)), WAIT_MS),
        ),
      ]),
  };
};

type Place = {
  base: string;
  workspace: string;
  runtimeDir: string;
  discoveryPath: string;
  pidDir: string;
  slice: string;
  pids: () => number[];
  /** The env for a service on this place: only what it needs, so nothing leaks in from the developer's shell. */
  env: (systemd: FakeSystemd, extra?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
};

/** A temp workspace (one repo), runtime dir, home and pid dir; agents left alive are killed afterwards. */
const place = (): Place => {
  const base = mkdtempSync(join(tmpdir(), "wombat-main-"));
  const workspace = join(base, "workspace");
  const runtimeDir = join(base, "run");
  const pidDir = join(base, "pids");
  const home = join(base, "home");
  mkdirSync(join(workspace, REPO), { recursive: true });
  mkdirSync(runtimeDir, { mode: 0o700 });
  mkdirSync(pidDir);
  mkdirSync(home);
  const slice = `wombattest${randomUUID().replaceAll("-", "")}.slice`;
  const pids = () => readdirSync(pidDir).map(Number);
  onTestFinished(() => {
    for (const pid of pids()) {
      for (const target of [-pid, pid]) {
        try {
          process.kill(target, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
    rmSync(base, { recursive: true, force: true });
  });
  return {
    base,
    workspace,
    runtimeDir,
    discoveryPath: join(runtimeDir, "wombat", "service.json"),
    pidDir,
    slice,
    pids,
    env: (systemd, extra = {}) => ({
      PATH: systemd.binDir,
      HOME: home,
      XDG_RUNTIME_DIR: runtimeDir,
      WOMBAT_WORKSPACE: workspace,
      WOMBAT_STORE: join(base, "state", "service.db"),
      WOMBAT_PORT: "0",
      ...extra,
    }),
  };
};

const fakes = () => {
  const systemd = fakeSystemd();
  onTestFinished(() => {
    const touched = systemd.calls().filter(({ args }) => args.some((arg) => arg.includes(SERVICE_SLICE)));
    systemd.remove();
    if (touched.length > 0) throw new Error(`a service under test touched the real slice: ${JSON.stringify(touched)}`);
  });
  return systemd;
};

const mode = (path: string) => (statSync(path).mode & 0o777).toString(8);

/** Waits for the discovery file; fails at once, with the service's stderr, if the service exits first. */
const waitForDiscovery = async (service: Spawned, path: string) => {
  const deadline = Date.now() + WAIT_MS;
  while (!existsSync(path)) {
    if (service.child.exitCode !== null || service.child.signalCode !== null) {
      throw new Error(`the service exited before writing the discovery file; stderr:\n${service.stderr()}`);
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for the discovery file; stderr:\n${service.stderr()}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const api = (file: DiscoveryFile, method: string, path: string, body?: unknown) =>
  rawRequest(file.port, { method, path, body, headers: { authorization: `Bearer ${file.token}`, origin: APP_ORIGIN } });

test(
  "start-up: one instance, a discovery file the app can read, and SIGTERM ends the service and its agents",
  async () => {
    const at = place();
    const systemd = fakes();
    const service = spawnService(
      ENTRY,
      at.env(systemd, { FAKE_AGENT_PID_DIR: at.pidDir, WOMBAT_TEST_SLICE: at.slice }),
    );
    const pid = service.child.pid;

    // The app's view: the file, read with the shared schema, then /version with its token.
    await waitForDiscovery(service, at.discoveryPath);
    expect(mode(join(at.runtimeDir, "wombat")), "discovery folder mode").toBe("700");
    expect(mode(at.discoveryPath), "discovery file mode").toBe("600");
    const text = readFileSync(at.discoveryPath, "utf8");
    const file = DiscoveryFile.parse(JSON.parse(text));
    expect(file).toMatchObject({ apiVersion: API_VERSION, pid });
    // Asked as soon as the file appears, without retrying: the file is written only once the server listens.
    const version = await api(file, "GET", "/version");
    expect(version.status).toBe(200);
    expect(VersionResponse.parse(version.json).apiVersion).toBe(API_VERSION);
    // The app tells a reused pid from the service by the start time, and a stale service by the code id of its checkout.
    expect(file.processStart, "the discovery file's processStart").toBe(startTimeOf(file.pid));
    const identity = version.json as { startedAt?: string; codeId?: string };
    expect(identity.codeId, "codeId isn't codeIdOf the checkout the service runs from").toBe(codeIdOf(join(SERVICE_DIR, "..")));
    expect(Date.parse(identity.startedAt ?? ""), "startedAt isn't a time").not.toBeNaN();

    const started = await api(file, "POST", "/agents", { harness: "fake-reply", repo: REPO });
    expect(started.status, started.text).toBeLessThan(300);
    await waitFor("the agent's process", () => at.pids().length > 0);

    // A second start on the same runtime dir: it finds the running one, names it and exits 0 (the app may start
    // the service whenever it doesn't see one, so this is not an error), before it opens a store or creates a
    // manager (which would stop the first one's slice). Its store is in a folder that must stay uncreated.
    const secondSystemd = fakes();
    const secondState = join(at.base, "second-state");
    const second = spawnService(MAIN, at.env(secondSystemd, { WOMBAT_STORE: join(secondState, "service.db") }));
    const secondExit = await second.exited();
    expect(secondExit, `second start's exit; stderr:\n${second.stderr()}`).toEqual({ code: 0, signal: null });
    expect(second.stderr(), "the refusal names the running instance's pid").toContain(String(file.pid));
    expect(second.stderr(), "the refusal names the running instance's port").toContain(String(file.port));
    expect(second.stdout()).toBe("");
    expect(secondSystemd.calls(), "a refused second start must not touch systemd").toEqual([]);
    expect(existsSync(secondState), "a refused second start must not open a store").toBe(false);
    expect(readFileSync(at.discoveryPath, "utf8"), "the first instance's file is untouched").toBe(text);
    const again = await api(file, "GET", "/version");
    expect(again.status).toBe(200);
    expect(again.json, "startedAt moved: computed per request, not once at start").toEqual(version.json);

    service.child.kill("SIGTERM");
    expect(await service.exited()).toEqual({ code: 0, signal: null });
    expect(existsSync(at.discoveryPath), "discovery file after SIGTERM").toBe(false);
    for (const agentPid of at.pids()) await waitFor(`agent ${String(agentPid)} to be gone`, () => !isAlive(agentPid));

    expect(service.stdout(), "stdout stays empty; logs go to stderr").toBe("");
    expect(service.stderr(), "a start line on stderr").not.toBe("");
    expect(service.stderr(), "the token is never logged").not.toContain(file.token);
  },
  TEST_TIMEOUT_MS * 2,
);

test(
  "a port that's already in use stops the start with a message naming the port and WOMBAT_PORT, and no discovery file",
  async () => {
    const holder = createNetServer();
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
    onTestFinished(() => new Promise<void>((resolve) => holder.close(() => resolve())));
    const port = (holder.address() as AddressInfo).port;

    const at = place();
    const systemd = fakes();
    // A store in a folder that must stay uncreated: a busy port is found before the store is opened.
    const state = join(at.base, "busy-port-state");
    const service = spawnService(
      MAIN,
      at.env(systemd, { WOMBAT_PORT: String(port), WOMBAT_STORE: join(state, "service.db") }),
    );
    const exit = await service.exited();
    expect(exit.code, `exit; stderr:\n${service.stderr()}`).not.toBe(0);
    expect(exit.code).not.toBeNull();
    expect(service.stderr()).toContain(String(port));
    expect(service.stderr()).toContain("WOMBAT_PORT");
    expect(service.stdout()).toBe("");
    expect(existsSync(at.discoveryPath), "no discovery file for a service that never listened").toBe(false);
    // Refused before the manager exists, whose start-up would stop the slice of whatever service runs.
    expect(systemd.calls(), "a start on a busy port must not touch systemd").toEqual([]);
    expect(existsSync(state), "a start on a busy port must not open a store").toBe(false);
  },
  TEST_TIMEOUT_MS,
);

/** The discovery file, when it parses; undefined while it's absent or half-way. */
const readDiscovery = (path: string): DiscoveryFile | undefined => {
  try {
    return DiscoveryFile.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
};

// Without the start lock, starts racing
// past the discovery check both open the store, both stop the slice (ending each other's agents) and both listen,
// and the app talks to whichever wrote the file last.
test(
  "four starts at once on one runtime dir: exactly one listens; each other one names it, exits 0 and touches nothing",
  async () => {
    const at = place();
    const env = (systemd: FakeSystemd) => at.env(systemd, { FAKE_AGENT_PID_DIR: at.pidDir, WOMBAT_TEST_SLICE: at.slice });
    const starts = [0, 1, 2, 3].map(() => {
      const systemd = fakes();
      return { systemd, service: spawnService(ENTRY, env(systemd)) };
    });

    // Every start that loses exits by itself; the one that wins never does. So wait until all but one have exited.
    const exits = new Map<number, Exit>();
    starts.forEach(({ service }, index) => {
      service.exited().then(
        (exit) => exits.set(index, exit),
        () => undefined,
      );
    });
    // A timeout here isn't the failure: the count of starts still running below is.
    await waitFor("all starts but one to exit", () => exits.size >= starts.length - 1).catch(() => undefined);
    const stillRunning = starts.filter((_, index) => !exits.has(index));
    expect(stillRunning, `exactly one start keeps running; exits: ${JSON.stringify([...exits])}`).toHaveLength(1);
    const winner = stillRunning[0]?.service;
    if (!winner) throw new Error("no running start");

    await waitForDiscovery(winner, at.discoveryPath);
    const file = readDiscovery(at.discoveryPath);
    expect(file?.pid, "the discovery file names the one that's running").toBe(winner.child.pid);
    if (!file) throw new Error("no discovery file");
    expect((await api(file, "GET", "/version")).status).toBe(200);

    for (const [index, exit] of exits) {
      const start = starts[index];
      if (!start) throw new Error("no such start");
      const label = `start ${String(index)}; stderr:\n${start.service.stderr()}`;
      expect(exit, label).toEqual({ code: 0, signal: null });
      expect(start.service.stderr(), `${label}: names the running one's pid`).toContain(String(file.pid));
      expect(start.service.stderr(), `${label}: names the running one's port`).toContain(String(file.port));
      expect(start.service.stdout(), label).toBe("");
      expect(start.systemd.calls(), `${label}: must not touch systemd (the slice)`).toEqual([]);
    }
    expect(winner.child.exitCode, "the winner still runs after the others left").toBeNull();
  },
  TEST_TIMEOUT_MS * 2,
);

// Silent failure: a lock left by a service that was killed must not keep the next one from starting; a start
// that waited on it would find the dead one's discovery file, name it as running and exit 0, and no service would run.
test(
  "a start after the running service was killed takes the lock over and listens",
  async () => {
    const at = place();
    const env = (systemd: FakeSystemd) => at.env(systemd, { FAKE_AGENT_PID_DIR: at.pidDir, WOMBAT_TEST_SLICE: at.slice });
    const killed = spawnService(ENTRY, env(fakes()));
    await waitForDiscovery(killed, at.discoveryPath);
    killed.child.kill("SIGKILL");
    expect((await killed.exited()).signal).toBe("SIGKILL");

    const next = spawnService(ENTRY, env(fakes()));
    await waitFor("the new start's discovery file", () => {
      if (next.child.exitCode !== null) throw new Error(`the new start exited; stderr:\n${next.stderr()}`);
      return readDiscovery(at.discoveryPath)?.pid === next.child.pid;
    });
    const file = readDiscovery(at.discoveryPath);
    if (!file) throw new Error("no discovery file");
    expect((await api(file, "GET", "/version")).status).toBe(200);
    expect(next.child.exitCode).toBeNull();
  },
  TEST_TIMEOUT_MS * 2,
);

// Across the route and the start-up's stop path: the app's stop button. A 202 that left agents running, the
// discovery file behind, or the agents' history gone would each go unnoticed until the next start.
test(
  "POST /shutdown with a running agent: 202 {}, the agent's scope ends, its history is kept as stopped, the file goes, exit 0",
  async () => {
    const at = place();
    const systemd = fakes();
    const storePath = join(at.base, "shutdown-state", "service.db");
    const service = spawnService(
      ENTRY,
      at.env(systemd, { FAKE_AGENT_PID_DIR: at.pidDir, WOMBAT_TEST_SLICE: at.slice, WOMBAT_STORE: storePath }),
    );
    await waitForDiscovery(service, at.discoveryPath);
    const file = DiscoveryFile.parse(JSON.parse(readFileSync(at.discoveryPath, "utf8")));

    const started = await api(file, "POST", "/agents", { harness: "fake-reply", repo: REPO });
    expect(started.status, started.text).toBe(201);
    const agentId = (started.json as { id: string }).id;
    const sent = await api(file, "POST", `/agents/${agentId}/messages`, { text: "Say hello" });
    expect(sent.status, sent.text).toBe(202);
    await waitFor("the agent's process", () => at.pids().length > 0);

    // Checks the end state (agents stopped with history kept, file gone, exit 0), not the order of 202 and the stop.
    const shutdown = await api(file, "POST", "/shutdown");
    expect(shutdown.status, shutdown.text).toBe(202);
    expect(shutdown.json).toEqual({});

    expect(await service.exited()).toEqual({ code: 0, signal: null });
    expect(existsSync(at.discoveryPath), "discovery file after /shutdown").toBe(false);
    expect(killedUnits(systemd.calls()), "the agent's scope was ended").toContain(`wombat-agent-${agentId}.scope`);
    for (const agentPid of at.pids()) await waitFor(`agent ${String(agentPid)} to be gone`, () => !isAlive(agentPid));

    const store = openStore({ path: storePath });
    onTestFinished(() => store.close());
    expect(store.listAgents().map(({ id, state }) => ({ id, state }))).toEqual([{ id: agentId, state: "stopped" }]);
    expect(store.readLog(agentId).entries.map((entry) => entry.type), "the agent's history is kept").toContain("user_message");
  },
  TEST_TIMEOUT_MS * 2,
);

// Silent failure: the app may give up on POST /shutdown (a timeout, the app quitting) while the agents are still
// stopping. The service must finish the stop anyway; otherwise it stays up with its agents gone, still listening,
// its discovery file and lock still there, and the next start finds it "running".
test(
  "POST /shutdown whose client goes away before the answer still ends the service: exit 0, discovery file gone",
  async () => {
    const at = place();
    // Holds the slice stop, which the shutdown reaches after the agents' scopes are killed and before it answers,
    // so the client can leave while the shutdown is certainly under way.
    const gate = join(at.base, "slice-stop-gate");
    const systemd = fakeSystemd({ stopGate: gate });
    onTestFinished(() => {
      writeFileSync(gate, "");
      systemd.remove();
    });
    const service = spawnService(ENTRY, at.env(systemd, { FAKE_AGENT_PID_DIR: at.pidDir, WOMBAT_TEST_SLICE: at.slice }));
    await waitForDiscovery(service, at.discoveryPath);
    const file = DiscoveryFile.parse(JSON.parse(readFileSync(at.discoveryPath, "utf8")));
    const started = await api(file, "POST", "/agents", { harness: "fake-reply", repo: REPO });
    expect(started.status, started.text).toBe(201);
    await waitFor("the agent's process", () => at.pids().length > 0);

    const answered: number[] = [];
    const request = httpRequest({
      host: "127.0.0.1",
      port: file.port,
      method: "POST",
      path: "/shutdown",
      headers: { authorization: `Bearer ${file.token}`, origin: APP_ORIGIN, host: `127.0.0.1:${String(file.port)}` },
    });
    request.on("response", (response) => answered.push(response.statusCode ?? 0));
    request.on("error", () => undefined);
    request.end();
    const sliceStop = () =>
      systemd.calls().some(({ tool, args }) => tool === "systemctl" && args.includes("stop") && args.includes(at.slice));
    await waitFor("the shutdown to reach the slice stop", sliceStop);

    request.destroy();
    expect(answered, "control: the client left before any answer").toEqual([]);
    // The stop path's first step removes the discovery file; the gate stays closed until then, so the client is
    // certainly gone before the shutdown could answer. A service that lost its stop path never gets here.
    await waitFor("the stop path to remove the discovery file", () => !existsSync(at.discoveryPath));
    writeFileSync(gate, "");

    expect(await service.exited()).toEqual({ code: 0, signal: null });
  },
  TEST_TIMEOUT_MS * 2,
);

// Silent failure (switching workspaces: the app stops the service, then starts one for the new workspace): while
// POST /shutdown is still stopping agents, a new start must not take the old service's discovery file for a running
// service. If it did, it would say "already running" and exit 0, the old one would exit next, and nothing would run.
test(
  "a start while POST /shutdown is still stopping agents waits for the old service and ends up listening",
  async () => {
    const at = place();
    const env = (systemd: FakeSystemd) => at.env(systemd, { FAKE_AGENT_PID_DIR: at.pidDir, WOMBAT_TEST_SLICE: at.slice });
    // Holds the old service's shutdown at its slice stop (after its agents' scopes are killed, before it answers).
    const gate = join(at.base, "slice-stop-gate");
    const oldSystemd = fakeSystemd({ stopGate: gate });
    onTestFinished(() => {
      writeFileSync(gate, "");
      oldSystemd.remove();
    });
    const old = spawnService(ENTRY, env(oldSystemd));
    await waitForDiscovery(old, at.discoveryPath);
    const oldFile = DiscoveryFile.parse(JSON.parse(readFileSync(at.discoveryPath, "utf8")));
    const started = await api(oldFile, "POST", "/agents", { harness: "fake-reply", repo: REPO });
    expect(started.status, started.text).toBe(201);
    await waitFor("the agent's process", () => at.pids().length > 0);

    const shutdown = api(oldFile, "POST", "/shutdown");
    // Awaited below; a test that fails before then mustn't also report the dropped connection.
    shutdown.catch(() => undefined);
    await waitFor("the old service's shutdown to reach the slice stop", () =>
      oldSystemd.calls().some(({ tool, args }) => tool === "systemctl" && args.includes("stop") && args.includes(at.slice)),
    );

    const next = spawnService(ENTRY, env(fakes()));
    // The gate opens once the old file is gone (the new start can't mistake it for a running service) or the new
    // start has given up; either comes well within the new start's wait for the lock.
    await waitFor("the old discovery file to go, or the new start to exit", () => !existsSync(at.discoveryPath) || next.child.exitCode !== null);
    expect(next.child.exitCode, `the new start must not leave while the old service shuts down; stderr:\n${next.stderr()}`).toBeNull();
    writeFileSync(gate, "");

    expect((await shutdown).status).toBe(202);
    expect(await old.exited(), `the old service; stderr:\n${old.stderr()}`).toEqual({ code: 0, signal: null });
    await waitFor("the new start's discovery file", () => {
      if (next.child.exitCode !== null) throw new Error(`the new start exited; stderr:\n${next.stderr()}`);
      return readDiscovery(at.discoveryPath)?.pid === next.child.pid;
    });
    const file = readDiscovery(at.discoveryPath);
    if (!file) throw new Error("no discovery file");
    expect((await api(file, "GET", "/version")).status).toBe(200);
    expect(next.child.exitCode).toBeNull();
  },
  TEST_TIMEOUT_MS * 2,
);
