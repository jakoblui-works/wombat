// The service as a process: spawned for real, found through the discovery file as the app will find it (parsed
// with the shared schema, so the writer can't drift from the reader), refusing a second instance, and ending
// cleanly on SIGTERM. Every spawned service gets recording fakes of
// systemd-run and systemctl as its whole PATH, so no run can ever stop the real wombat-agents.slice.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { API_VERSION } from "@wombat/shared";
import { VersionResponse } from "@wombat/shared/api";
import { DiscoveryFile } from "@wombat/shared/discovery";
import { expect, onTestFinished, test } from "vitest";

import { fakeSystemd, type FakeSystemd } from "./fake-systemd.ts";
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

    const started = await api(file, "POST", "/agents", { harness: "fake-reply", repo: REPO });
    expect(started.status, started.text).toBeLessThan(300);
    await waitFor("the agent's process", () => at.pids().length > 0);

    // A second start on the same runtime dir: refused before it opens a store or creates a manager (which
    // would stop the first one's slice). Its store is in a folder that must stay uncreated.
    const secondSystemd = fakes();
    const secondState = join(at.base, "second-state");
    const second = spawnService(MAIN, at.env(secondSystemd, { WOMBAT_STORE: join(secondState, "service.db") }));
    const secondExit = await second.exited();
    expect(secondExit.code, `second start's exit; stderr:\n${second.stderr()}`).not.toBe(0);
    expect(secondExit.code).not.toBeNull();
    expect(second.stderr(), "the refusal names the running instance's pid").toContain(String(file.pid));
    expect(second.stderr(), "the refusal names the running instance's port").toContain(String(file.port));
    expect(second.stdout()).toBe("");
    expect(secondSystemd.calls(), "a refused second start must not touch systemd").toEqual([]);
    expect(existsSync(secondState), "a refused second start must not open a store").toBe(false);
    expect(readFileSync(at.discoveryPath, "utf8"), "the first instance's file is untouched").toBe(text);
    expect((await api(file, "GET", "/version")).status).toBe(200);

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
