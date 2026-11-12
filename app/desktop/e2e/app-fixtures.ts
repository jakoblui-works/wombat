// The one way an e2e check launches the app (interface-S3, "Safety for every test in this slice"). The checks run
// on a machine where the real service and agents may be running, so every launch gets a sandbox of its own:
// - temp HOME, XDG_RUNTIME_DIR, XDG_STATE_HOME, XDG_CONFIG_HOME (the profile), XDG_DATA_HOME and XDG_CACHE_HOME;
// - a temp workspace with one repo;
// - PATH holding only recording fakes of systemd-run and systemctl, `node` and `sleep`, so no real systemd is
//   reached. What keeps a real `claude` out is the entry's harness list (fake agents only) and the sandbox HOME,
//   with no CLAUDE*/ANTHROPIC* variables passed on; PATH alone wouldn't (the service starts claude-agent-acp from
//   its own node_modules);
// - the service run through service/test/app-e2e-entry.ts (WOMBAT_E2E_SERVICE_ENTRY): fake agents, the test's own
//   slice, every start's pid recorded;
// - WOMBAT_PORT=0, so a test service never takes (or collides with) the real service's port;
// - WOMBAT_E2E_SANDBOX_ROOT, which the entry checks: it refuses to start unless HOME, XDG_RUNTIME_DIR and
//   XDG_STATE_HOME lie under it, so a start whose env was rebuilt can't write the real discovery file, lock or store.
// Teardown kills every app, service and agent the sandbox saw, removes the sandbox, and fails the test if anything
// asked systemd about the real slice.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, test as base, expect, type ElectronApplication, type Page } from "@playwright/test";
import { APP_ORIGIN } from "@wombat/shared";
import { fakeSystemd, type Call, type FakeSystemd, type FakeSystemdOptions } from "../../service/test/fake-systemd.ts";
import { CHANNELS } from "../src/shared/bridge.ts";
import { E2E_NOTIFICATIONS } from "../src/main/e2e-switches.ts";
import { SWITCH } from "../src/shared/e2e-switch-names.ts";

export { E2E_NOTIFICATIONS, SWITCH };

/** The slice the real service uses; nothing under test may ever name it. */
const REAL_SLICE = "wombat-agents.slice";

/** The repo every sandbox workspace holds (invented). */
export const REPO = "bakery-site";

/**
 * The window's content size. Under the headless platform a hidden window's content is 1x1, too small for anything
 * laid out (dockview's groups, a drag between them); every launch gets this size.
 */
export const VIEWPORT = { width: 1440, height: 900 };

/** How long a check waits for the app or a service to get somewhere. */
export const WAIT_MS = 20_000;

// Keep runs off the desktop: Electron runs on Chromium's headless platform (HEADLESS_ARGS), and the display
// variables are dropped.
const HEADLESS_ARGS = ["--ozone-platform=headless"];
// Never passed on from the runner's env: the display, the user's own dirs and tools, and anything Wombat or Claude.
// WAYLAND_DISPLAY and DBUS_SESSION_BUS_ADDRESS are then set to dead values (see `env`), not left unset: unset,
// Wayland falls back to the socket `wayland-0` and GDBus to $XDG_RUNTIME_DIR/bus. With a dead bus, portal dialogs,
// desktop notifications and shell.showItemInFolder can't reach the desktop.
const DROPPED_ENV = /^(DISPLAY|WAYLAND_.*|XAUTHORITY|ELECTRON_OZONE_PLATFORM_HINT|ELECTRON_RUN_AS_NODE|DBUS_SESSION_BUS_ADDRESS|HOME|PATH|XDG_.*|WOMBAT_.*|ANTHROPIC_.*|CLAUDE.*|NODE_OPTIONS|ASDF_.*|SSH_AUTH_SOCK|GIT_.*)$/;

export type Discovery = { apiVersion: number; port: number; pid: number; token: string; workspace?: string };

export type LaunchOptions = {
  /** XDG_CONFIG_HOME for this app (default the sandbox's first profile); see `Sandbox.newProfile`. */
  profile?: string;
  /** WOMBAT_E2E_WORKSPACE (default the sandbox's workspace); null leaves it unset. */
  workspaceAnswer?: string | null;
  /** More env for the app (the quit and restart answers). */
  env?: Record<string, string>;
  /**
   * Runs as soon as the app's window exists, before the page has loaded (so before it has subscribed to anything):
   * for what main sends a page that isn't listening yet.
   */
  onWindow?: (app: ElectronApplication) => Promise<void>;
};

export type LaunchedApp = {
  app: ElectronApplication;
  page: Page;
  profile: string;
  /** Asks the app to quit, as the user would (before-quit runs). */
  quit: () => Promise<void>;
  /** Resolves once the app's process has exited; fails after `timeoutMs`. */
  exited: (timeoutMs?: number) => Promise<void>;
  isRunning: () => boolean;
  /** Electron's pid, taken at launch (Playwright's handle may be gone once the app has exited). */
  pid: number | undefined;
};

export type Sandbox = {
  base: string;
  /** The default workspace (holds REPO). */
  workspace: string;
  /** Another workspace, holding REPO. */
  newWorkspace: (name: string) => string;
  /** A fresh, empty XDG_CONFIG_HOME. */
  newProfile: () => string;
  /** The profile launches use by default. */
  profile: string;
  runtimeDir: string;
  stateDir: string;
  discoveryPath: string;
  systemd: FakeSystemd;
  /** Lets a held `systemctl stop` finish (sandboxes made with `holdStop`). */
  releaseStop: () => void;
  /** `$XDG_CONFIG_HOME/Wombat/settings.json` (contract "Settings file"). */
  settingsPath: (profile?: string) => string;
  /** Writes settings.json (an object as JSON, a string as is) into a profile before a launch. */
  writeSettings: (content: unknown, profile?: string) => void;
  /** settings.json parsed, or undefined while it's missing or not JSON. */
  readSettings: (profile?: string) => Record<string, unknown> | undefined;
  launch: (options?: LaunchOptions) => Promise<LaunchedApp>;
  /** Starts a service directly (as one left running from before), for `workspace`; resolves once it's found. */
  startService: (workspace: string, env?: Record<string, string>) => Promise<Discovery>;
  /** The discovery file's content, raw (so fields the shared schema doesn't know yet are kept); undefined when absent. */
  discovery: () => Discovery | undefined;
  /** Waits for a discovery file whose service is alive and answers /version with its token, and that passes `check`. */
  waitForService: (check?: (file: Discovery) => boolean, timeoutMs?: number) => Promise<Discovery>;
  /** Every service start so far (pids, the ones that exited too), including one spawned a moment ago. */
  serviceStarts: () => number[];
  /** The service pids still alive. */
  liveServices: () => number[];
  agentPids: () => number[];
  /** A call to the running service as the app makes it (token, Origin); the test is the only other client. */
  api: (method: string, pathname: string, body?: unknown) => Promise<{ status: number; json: unknown }>;
  /** A free port other than `not`. */
  freePort: (not?: number) => Promise<number>;
};

const isAlivePid = (pid: number): boolean => {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
  } catch {
    return false;
  }
  // A zombie has exited; only its parent hasn't collected it yet.
  return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
};
export const isAlive = isAlivePid;

const killGroupAndPid = (pid: number): void => {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      // Gone already, or not a group leader.
    }
  }
};

/**
 * This sandbox's service-entry processes alive now, found in /proc by their command line and their
 * WOMBAT_E2E_SANDBOX_ROOT. With the pids the entry records, a start is counted from the moment it's spawned: it's
 * alive, or it has already recorded its pid (the entry records it before anything else).
 */
const sandboxEntryProcesses = (root: string): number[] => {
  const found: number[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const cmdline = readFileSync(`/proc/${name}/cmdline`, "utf8");
      if (!cmdline.includes("app-e2e-entry.ts")) continue;
      const environ = readFileSync(`/proc/${name}/environ`, "utf8").split("\0");
      if (environ.includes(`WOMBAT_E2E_SANDBOX_ROOT=${root}`)) found.push(Number(name));
    } catch {
      // Gone meanwhile, or not ours to read.
    }
  }
  return found;
};

const pidsIn = (dir: string): number[] => (existsSync(dir) ? readdirSync(dir).map(Number).filter((pid) => pid > 0) : []);

const which = (name: string): string => {
  for (const dir of ["/usr/bin", "/bin"]) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`The e2e sandbox needs \`${name}\` in /usr/bin or /bin.`);
};

const desktopDir = (): string => {
  const configFile = test.info().config.configFile;
  if (!configFile) throw new Error("Run these checks through `playwright test` with app/desktop/playwright.config.ts.");
  return path.dirname(configFile);
};

const mainEntry = (): string => {
  const entry = path.join(desktopDir(), "out", "main", "index.js");
  if (!existsSync(entry)) throw new Error(`The built app is missing (${entry}). Build it first: \`pnpm exec electron-vite build\` in app/desktop.`);
  return entry;
};

const serviceEntry = (): string => path.join(desktopDir(), "..", "service", "test", "app-e2e-entry.ts");

const sliceCalls = (calls: Call[]): Call[] => calls.filter(({ args }) => args.some((arg) => arg.includes(REAL_SLICE)));

const until = async <T>(what: string, timeoutMs: number, probe: () => Promise<T | undefined> | T | undefined): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${String(timeoutMs)} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

export type SandboxOptions = Omit<FakeSystemdOptions, "stopGate"> & {
  /** Fake `systemctl stop` waits until `Sandbox.releaseStop()` (a gate file under the sandbox root). */
  holdStop?: boolean;
};

const createSandbox = ({ holdStop = false, ...systemdOptions }: SandboxOptions): { sandbox: Sandbox; teardown: () => Promise<void> } => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "wombat-e2e-")));
  const stopGate = holdStop ? path.join(root, "stop-gate") : undefined;
  const dir = (...parts: string[]): string => {
    const at = path.join(root, ...parts);
    mkdirSync(at, { recursive: true, mode: 0o700 });
    return at;
  };
  const home = dir("home");
  const runtimeDir = dir("run");
  const stateDir = dir("state");
  const dataDir = dir("data");
  const cacheDir = dir("cache");
  const agentPidDir = dir("pids", "agents");
  const servicePidDir = dir("pids", "services");
  const slice = `wombate2e${String(process.pid)}${String(Date.now())}${String(Math.floor(Math.random() * 1e6))}.slice`;
  const systemd = fakeSystemd(stopGate === undefined ? systemdOptions : { ...systemdOptions, stopGate });
  symlinkSync(process.execPath, path.join(systemd.binDir, "node"));
  symlinkSync(which("sleep"), path.join(systemd.binDir, "sleep"));

  let profiles = 0;
  const newProfile = (): string => dir(`config-${String(++profiles)}`);
  const profile = newProfile();
  const newWorkspace = (name: string): string => {
    const at = dir("workspaces", name);
    mkdirSync(path.join(at, REPO), { recursive: true });
    return at;
  };
  const workspace = newWorkspace("main");
  const discoveryPath = path.join(runtimeDir, "wombat", "service.json");

  const env = (extra: Record<string, string> = {}): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !DROPPED_ENV.test(key)) out[key] = value;
    }
    return {
      ...out,
      HOME: home,
      PATH: systemd.binDir,
      XDG_RUNTIME_DIR: runtimeDir,
      XDG_STATE_HOME: stateDir,
      XDG_CONFIG_HOME: profile,
      XDG_DATA_HOME: dataDir,
      XDG_CACHE_HOME: cacheDir,
      WAYLAND_DISPLAY: "/nonexistent/wombat-e2e-no-display",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent/wombat-e2e-no-bus",
      [SWITCH.e2e]: "1",
      [SWITCH.serviceEntry]: serviceEntry(),
      WOMBAT_PORT: "0",
      FAKE_AGENT_PID_DIR: agentPidDir,
      WOMBAT_TEST_SLICE: slice,
      WOMBAT_E2E_SERVICE_PID_DIR: servicePidDir,
      WOMBAT_E2E_SANDBOX_ROOT: root,
      ...extra,
    };
  };

  const settingsPath = (at = profile): string => path.join(at, "Wombat", "settings.json");
  const discovery = (): Discovery | undefined => {
    try {
      return JSON.parse(readFileSync(discoveryPath, "utf8")) as Discovery;
    } catch {
      return undefined;
    }
  };

  const api: Sandbox["api"] = async (method, pathname, body) => {
    const file = discovery();
    if (!file) throw new Error(`${method} ${pathname}: no discovery file at ${discoveryPath}`);
    const response = await fetch(`http://127.0.0.1:${String(file.port)}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${file.token}`,
        origin: APP_ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5_000),
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, json };
  };

  const answers = async (file: Discovery): Promise<boolean> => {
    try {
      const response = await fetch(`http://127.0.0.1:${String(file.port)}/version`, {
        headers: { authorization: `Bearer ${file.token}`, origin: APP_ORIGIN },
        signal: AbortSignal.timeout(2_000),
      });
      await response.body?.cancel();
      return response.status === 200;
    } catch {
      return false;
    }
  };

  const waitForService: Sandbox["waitForService"] = (check = () => true, timeoutMs = WAIT_MS) =>
    until("a running service in the sandbox's discovery file", timeoutMs, async () => {
      const file = discovery();
      return file && isAlivePid(file.pid) && check(file) && (await answers(file)) ? file : undefined;
    });

  const apps: LaunchedApp[] = [];
  const directServices: ChildProcess[] = [];

  const launch: Sandbox["launch"] = async ({ profile: at = profile, workspaceAnswer = workspace, env: extra = {}, onWindow } = {}) => {
    const appEnv = env({ XDG_CONFIG_HOME: at, ...extra });
    if (workspaceAnswer !== null) appEnv[SWITCH.workspace] = workspaceAnswer;
    const app = await electron.launch({ args: [...HEADLESS_ARGS, mainEntry()], env: appEnv, chromiumSandbox: true });
    const child = app.process();
    const exit = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      child.once("exit", () => resolve());
    });
    const launched: LaunchedApp = {
      app,
      page: undefined as unknown as Page,
      profile: at,
      quit: async () => {
        // The evaluate may never answer once the app is gone; the quit is what matters.
        await app
          .evaluate(({ app: electronApp }) => {
            setTimeout(() => electronApp.quit(), 0);
          })
          .catch(() => undefined);
      },
      exited: (timeoutMs = WAIT_MS) =>
        Promise.race([
          exit,
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`the app didn't exit within ${String(timeoutMs)} ms`)), timeoutMs)),
        ]),
      isRunning: () => child.exitCode === null && child.signalCode === null,
      pid: child.pid,
    };
    apps.push(launched);
    // Safety net, after the fact: by now the app has started up, so this only reports a profile outside the sandbox
    // (and stops the app); what keeps it inside is the temp HOME and XDG_CONFIG_HOME above.
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"));
    if (!userData.startsWith(`${root}${path.sep}`)) {
      child.kill("SIGKILL");
      throw new Error(`SAFETY: the app's userData is ${userData}, outside the e2e sandbox ${root}; stopped it.`);
    }
    launched.page = await app.firstWindow();
    if (onWindow) await onWindow(app);
    await app.evaluate(({ BrowserWindow }, { width, height }) => {
      for (const window of BrowserWindow.getAllWindows()) window.setContentSize(width, height);
    }, VIEWPORT);
    await launched.page.waitForLoadState("domcontentloaded");
    return launched;
  };

  const startService: Sandbox["startService"] = async (forWorkspace, extra = {}) => {
    const log = openSync(path.join(root, `direct-service-${String(directServices.length)}.log`), "a", 0o600);
    const child = spawn(process.execPath, [serviceEntry()], {
      env: env({ WOMBAT_WORKSPACE: forWorkspace, ...extra }),
      detached: true,
      stdio: ["ignore", log, log],
    });
    directServices.push(child);
    return waitForService((file) => file.pid === child.pid);
  };

  const freePort: Sandbox["freePort"] = async (not) => {
    for (;;) {
      const port = await new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const { port: bound } = server.address() as AddressInfo;
          server.close(() => resolve(bound));
        });
      });
      if (port !== not) return port;
    }
  };

  const sandbox: Sandbox = {
    base: root,
    workspace,
    newWorkspace,
    newProfile,
    profile,
    runtimeDir,
    stateDir,
    discoveryPath,
    systemd,
    releaseStop: () => {
      if (stopGate === undefined) throw new Error("releaseStop: this sandbox wasn't made with holdStop");
      writeFileSync(stopGate, "");
    },
    settingsPath,
    writeSettings: (content, at = profile) => {
      const file = settingsPath(at);
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2), { mode: 0o600 });
    },
    readSettings: (at = profile) => {
      try {
        return JSON.parse(readFileSync(settingsPath(at), "utf8")) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    },
    launch,
    startService,
    discovery,
    waitForService,
    serviceStarts: () => [...new Set([...pidsIn(servicePidDir), ...sandboxEntryProcesses(root)])].sort((a, b) => a - b),
    liveServices: () => [...new Set([...pidsIn(servicePidDir), ...sandboxEntryProcesses(root)])].filter(isAlivePid).sort((a, b) => a - b),
    agentPids: () => pidsIn(agentPidDir),
    api,
    freePort,
  };

  const teardown = async (): Promise<void> => {
    if (stopGate !== undefined) writeFileSync(stopGate, "");
    // The app's whole process group (Playwright starts Electron as a group leader): Chromium's helpers would
    // otherwise go on writing into the profile while it's being removed.
    for (const launched of apps) {
      if (launched.pid !== undefined) killGroupAndPid(launched.pid);
      await launched.exited(5_000).catch(() => undefined);
    }
    const file = discovery();
    const services = [...pidsIn(servicePidDir), ...sandboxEntryProcesses(root), ...(file ? [file.pid] : []), ...directServices.flatMap((child) => (child.pid ? [child.pid] : []))];
    for (const pid of services) killGroupAndPid(pid);
    for (const pid of pidsIn(agentPidDir)) killGroupAndPid(pid);
    const touched = sliceCalls(systemd.calls());
    systemd.remove();
    // Retried until it stays gone: a helper may still be writing its last file.
    for (let tries = 0; tries < 20; tries++) {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!existsSync(root)) break;
    }
    if (touched.length > 0) throw new Error(`SAFETY: something under test asked systemd about the real slice: ${JSON.stringify(touched)}`);
  };

  return { sandbox, teardown };
};

/**
 * `test` with a `sandbox` (default fake systemd) and `makeSandbox(options)` for one with other fake-systemd options or a held `systemctl stop`.
 * Every sandbox made in a test is torn down after it.
 */
export const test = base.extend<{ makeSandbox: (options?: SandboxOptions) => Sandbox; sandbox: Sandbox }>({
  // Playwright's fixture signature: the first argument must be destructured, even when empty.
  // eslint-disable-next-line no-empty-pattern
  makeSandbox: async ({}, use) => {
    const made: (() => Promise<void>)[] = [];
    await use((options = {}) => {
      const { sandbox, teardown } = createSandbox(options);
      made.push(teardown);
      return sandbox;
    });
    const failures: unknown[] = [];
    for (const teardown of made) await teardown().catch((error: unknown) => failures.push(error));
    if (failures.length > 0) throw failures[0];
  },
  sandbox: async ({ makeSandbox }, use) => {
    await use(makeSandbox());
  },
});

export { expect };

/** Polls `probe` until it returns something other than undefined; fails naming `what`. */
export const waitUntil = until;

type ConnectionWindow = {
  wombat?: { service?: { onConnection?: (cb: (state: { state: string; message?: string }) => void) => unknown; onAlert?: (cb: (alert: unknown) => void) => unknown } };
  __e2eConnection?: { state: string; message?: string }[];
  __e2eAlerts?: unknown[];
};

/** Subscribes the page to the bridge's connection states and alerts, recording them in the page. */
export const watchBridge = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const w = window as unknown as ConnectionWindow;
    const service = w.wombat?.service;
    if (typeof service?.onConnection !== "function" || typeof service.onAlert !== "function") {
      throw new Error("window.wombat.service.onConnection / onAlert are missing (T6's bridge)");
    }
    if (w.__e2eConnection) return;
    w.__e2eConnection = [];
    w.__e2eAlerts = [];
    service.onConnection((state) => w.__e2eConnection?.push(state));
    service.onAlert((alert) => w.__e2eAlerts?.push(alert));
  });
};

/** The connection states the page has seen, in order. */
export const connectionStates = (page: Page): Promise<string[]> =>
  page.evaluate(() => ((window as unknown as ConnectionWindow).__e2eConnection ?? []).map(({ state }) => state));

/** The alerts the page has received, in order. */
export const alertsSeen = (page: Page): Promise<unknown[]> => page.evaluate(() => [...((window as unknown as ConnectionWindow).__e2eAlerts ?? [])]);

/** Waits until the page's latest connection state is `state`, after at least `after` states were seen. */
export const waitForConnection = async (page: Page, state: string, { after = 0, timeoutMs = WAIT_MS } = {}): Promise<void> => {
  await watchBridge(page);
  await until(`the page's connection state to become ${state}`, timeoutMs, async () => {
    const states = await connectionStates(page);
    return states.length > after && states.at(-1) === state ? true : undefined;
  });
};

/** Calls `window.wombat.service.request` in the page: the answer, or the error it rejected with. */
export const bridgeRequest = (
  page: Page,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ ok: true; status: number; body: unknown } | { ok: false; error: string }> =>
  page.evaluate(
    async ([m, p, b]) => {
      type Request = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;
      const request = (window as unknown as { wombat?: { service?: { request?: Request } } }).wombat?.service?.request;
      if (typeof request !== "function") throw new Error("window.wombat.service.request is missing (T6's bridge)");
      try {
        const answer = b === undefined ? await request(m, p) : await request(m, p, b);
        return { ok: true as const, status: answer.status, body: answer.body };
      } catch (error) {
        return { ok: false as const, error: String(error) };
      }
    },
    [method, pathname, body] as const,
  );

/** Starts a fake agent through the test's own client and returns its id. */
export const startAgent = async (sandbox: Sandbox, harness: "fake-reply" | "fake-permission" | "fake-hang" | "fake-hostile"): Promise<string> => {
  const started = await sandbox.api("POST", "/agents", { harness, repo: REPO });
  expect(started.status, `start ${harness}: ${JSON.stringify(started.json)}`).toBe(201);
  return (started.json as { id: string }).id;
};

type Summary = { id: string; state: string; title?: string; lastText?: string; pendingPermissions?: { title: string }[] };

/** The agent's summary from GET /agents. */
export const agentSummary = async (sandbox: Sandbox, agentId: string): Promise<Summary | undefined> => {
  const listed = await sandbox.api("GET", "/agents");
  return (listed.json as { agents: Summary[] }).agents.find((agent) => agent.id === agentId);
};

/** Starts a `fake-permission` agent, prompts it, and waits until it's waiting on a permission answer. */
export const startWaitingAgent = async (sandbox: Sandbox, prompt: string): Promise<string> => {
  const agentId = await startAgent(sandbox, "fake-permission");
  const sent = await sandbox.api("POST", `/agents/${agentId}/messages`, { text: prompt });
  expect(sent.status, `prompt: ${JSON.stringify(sent.json)}`).toBe(202);
  await until(`agent ${agentId} to be waiting`, WAIT_MS, async () => ((await agentSummary(sandbox, agentId))?.state === "waiting" ? true : undefined));
  return agentId;
};

/** One editor group as the page shows it: its tabs' text and the active tab's. */
export type GroupView = { tabs: string[]; active: string | undefined };

/** Asks the page to open an agent's chat, as main does for a notification click. */
export const sendOpenAgent = (app: ElectronApplication, agentId: string): Promise<void> =>
  app.evaluate(
    ({ BrowserWindow }, [channel, id]) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(channel, id);
    },
    [CHANNELS.openAgent, agentId] as const,
  );

// 0 while the page is still loading (its context may be replaced under the count).
export const tabCount = (page: Page): Promise<number> => page.locator(".dv-tab").count().catch(() => 0);

/** Opens the agent's chat once, as one notification click would, and waits for its tab (the `tabsAfter`th). */
export const openAgent = async (launched: LaunchedApp, agentId: string, tabsAfter: number): Promise<void> => {
  await sendOpenAgent(launched.app, agentId);
  await until(`the chat tab of ${agentId}`, WAIT_MS, async () => ((await tabCount(launched.page)) >= tabsAfter ? true : undefined));
};

/** The editor's groups, left to right then top to bottom, each with its tabs' text and the active tab's. */
export const layoutOf = (page: Page): Promise<GroupView[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".dv-groupview")]
      .map((group) => {
        const box = group.getBoundingClientRect();
        const tabs = [...group.querySelectorAll<HTMLElement>(".dv-tab")];
        return {
          x: box.x,
          y: box.y,
          tabs: tabs.map((tab) => (tab.textContent ?? "").trim()),
          active: group.querySelector<HTMLElement>(".dv-tab.dv-active-tab")?.textContent?.trim(),
        };
      })
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .map(({ tabs, active }) => ({ tabs, active })),
  );
