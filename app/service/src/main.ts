import { createServer } from "node:net";

import { API_VERSION } from "@wombat/shared";

import { createManager, logToStderr, type Manager } from "./agents/manager.ts";
import { readConfig } from "./config.ts";
import { findRunningService, newToken, removeDiscovery, writeDiscovery } from "./discovery.ts";
import type { Harness } from "./harness/harness.ts";
import { defaultHarnesses } from "./harness/registry.ts";
import { startServer } from "./server/server.ts";
import { openStore, type Store } from "./store/store.ts";

export type MainOptions = {
  /** Default process.env. */
  env?: NodeJS.ProcessEnv;
  /** Default the registered harnesses. */
  harnesses?: readonly Harness[];
  /** Default the service's own slice. */
  slice?: string;
};

/** A start-up failure the user can fix from its message alone, so it's printed without a stack trace. */
class StartRefused extends Error {}

const fail = (error: unknown): never => {
  if (error instanceof StartRefused) {
    process.stderr.write(`${error.message}\n`);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    // The stack goes after the message, for a bug report; the message alone says what to do.
    const stack = error instanceof Error && error.stack !== undefined ? `\n${error.stack}` : "";
    process.stderr.write(
      `The service couldn't start: ${message.replace(/\.$/, "")}. Fix the cause above and start the service again.${stack}\n`,
    );
  }
  process.exit(1);
};

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

/** A failure to listen on `port` the user can fix by choosing another; undefined for anything else. */
const listenRefusal = (port: number, error: unknown): StartRefused | undefined => {
  const next = "Set WOMBAT_PORT to another port (or 0 for any free port) and start the service again.";
  switch (errorCode(error)) {
    case "EADDRINUSE":
      return new StartRefused(`Port ${String(port)} is already in use by another program. ${next}`);
    case "EACCES":
      return new StartRefused(
        `The service isn't allowed to listen on port ${String(port)} (ports below 1024 need privileges). ` +
          "Set WOMBAT_PORT to 1024 or above (or 0 for any free port) and start the service again.",
      );
    case "EADDRNOTAVAIL":
      return new StartRefused(`The service can't listen on 127.0.0.1 port ${String(port)} on this machine. ${next}`);
    default:
      return undefined;
  }
};

/** Binds the port on 127.0.0.1 and lets it go again; 0 always can be bound. */
const probePort = (port: number) =>
  new Promise<void>((resolve, reject) => {
    if (port === 0) return resolve();
    const probe = createServer();
    probe.once("error", (error) => reject(listenRefusal(port, error) ?? error));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });

/** Runs the service: config, single-instance check, store, manager, server, discovery file, signals. */
export const main = async (options: MainOptions = {}): Promise<void> => {
  const env = options.env ?? process.env;
  const harnesses = options.harnesses ?? defaultHarnesses;
  const log = logToStderr;

  let config: ReturnType<typeof readConfig>;
  try {
    config = readConfig(env);
  } catch (error) {
    return fail(new StartRefused((error as Error).message));
  }

  // Checked before the store and manager open: the manager stops its slice at creation, which would end the
  // running instance's agents, and the shared database would refuse a second writer.
  const running = await findRunningService(config.discoveryPath);
  if (running) {
    return fail(
      new StartRefused(
        `A Wombat service is already running (pid ${String(running.pid)}, port ${String(running.port)}). ` +
          `Use that one, or stop it (kill ${String(running.pid)}) before starting another.`,
      ),
    );
  }

  // Also before the manager: a start that can't listen mustn't stop the slice on its way out. startServer
  // still refuses the port if another program takes it in between.
  try {
    await probePort(config.port);
  } catch (error) {
    return fail(error);
  }

  let store: Store | undefined;
  let manager: Manager | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const token = newToken();
  try {
    store = openStore({ path: config.storePath });
    const slice = options.slice === undefined ? {} : { slice: options.slice };
    manager = createManager({ store, workspaceRoot: config.workspaceRoot, harnesses, log, env, ...slice });
    try {
      server = await startServer({ manager, store, harnesses, token, port: config.port, log });
    } catch (error) {
      throw listenRefusal(config.port, error) ?? error;
    }
    try {
      writeDiscovery(config.discoveryPath, { apiVersion: API_VERSION, port: server.port, pid: process.pid, token });
    } catch (error) {
      throw new StartRefused(
        `The service couldn't write its discovery file ${config.discoveryPath} (${(error as Error).message}). ` +
          "Make sure XDG_RUNTIME_DIR is a folder you can write to, or set it to one, and start the service again.",
      );
    }
  } catch (error) {
    // Best effort: the start failure is what the user needs to see, not a follow-on error from cleaning up.
    await server?.close().catch(() => undefined);
    await manager?.shutdown().catch(() => undefined);
    try {
      store?.close();
    } catch {
      // The start failure is reported next; a close error on top would only hide it.
    }
    return fail(error);
  }

  log("service_started", { pid: process.pid, port: server.port, apiVersion: API_VERSION });

  const { discoveryPath } = config;
  const openedStore = store;
  const openedManager = manager;
  const openedServer = server;
  let stopping: Promise<void> | undefined;
  const stop = (signal: NodeJS.Signals) => {
    stopping ??= (async () => {
      log("service_stopping", { signal });
      let failed = false;
      // Each step runs even if one before it failed, so agents are never left running because the port wouldn't close.
      const step = async (name: string, run: () => unknown) => {
        try {
          await run();
        } catch (error) {
          failed = true;
          log("shutdown_step_failed", { step: name, error: error instanceof Error ? error.name : "unknown" });
        }
      };
      await step("discovery", () => removeDiscovery(discoveryPath, process.pid));
      await step("server", () => openedServer.close());
      await step("manager", () => openedManager.shutdown());
      await step("store", () => openedStore.close());
      process.exit(failed ? 1 : 0);
    })();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
};

if (import.meta.main) await main();
