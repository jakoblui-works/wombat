import { createServer } from "node:net";

import { API_VERSION } from "@wombat/shared";

import { createManager, type Manager } from "./agents/manager.ts";
import { readConfig } from "./config.ts";
import { newToken, removeDiscovery, writeDiscovery } from "./discovery.ts";
import { errorCode } from "./errno.ts";
import { openCatalog } from "./items/catalog.ts";
import { openInstructions, readInstructions, refreshingWriter, type Instructions } from "./items/instructions.ts";
import type { Harness } from "./harness/harness.ts";
import { defaultHarnesses } from "./harness/registry.ts";
import { openWriter } from "./items/write.ts";
import { logToStderr } from "./log.ts";
import { startServer } from "./server/server.ts";
import { LockHeld, takeStartLock } from "./start-lock.ts";
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

/** Releases the start lock on a failed start; a release error would only hide the start failure reported next. */
const releaseQuietly = (lock: { release: () => void }) => {
  try {
    lock.release();
  } catch {
    // The lock names this process, so a start after it exits takes it over anyway.
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

  // Start-up order: lock, probe the port, open the store and manager, listen, write the discovery file. The lock
  // comes first: the manager stops its slice at creation, which would end a running instance's agents, and the
  // shared database would refuse a second writer. It's released only after the store closes (see start-lock.ts).
  let lock: Awaited<ReturnType<typeof takeStartLock>>;
  try {
    lock = await takeStartLock(config.discoveryPath);
  } catch (error) {
    return fail(error instanceof LockHeld ? new StartRefused(error.message) : error);
  }
  if (!lock.held) {
    // The app may start the service whenever it doesn't see one, so finding one running isn't an error.
    const { pid, port } = lock.running;
    process.stderr.write(
      `A Wombat service is already running (pid ${String(pid)}, port ${String(port)}); this start leaves it running and exits.\n`,
    );
    return process.exit(0);
  }

  // Before the manager: a start that can't listen mustn't stop the slice on its way out. startServer still
  // refuses the port if another program takes it in between.
  try {
    await probePort(config.port);
  } catch (error) {
    releaseQuietly(lock);
    return fail(error);
  }

  let store: Store | undefined;
  let manager: Manager | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let instructions: Instructions | undefined;
  const token = newToken();
  try {
    store = openStore({ path: config.storePath });
    const slice = options.slice === undefined ? {} : { slice: options.slice };
    manager = createManager({
      store,
      workspaceRoot: config.workspaceRoot,
      harnesses,
      log,
      env,
      readInstructions: () => readInstructions(config.workspaceRoot, log),
      ...slice,
    });
    try {
      const { itemsRoot, workspaceRoot } = config;
      const catalog = itemsRoot === undefined ? undefined : openCatalog({ root: itemsRoot, store, log });
      instructions = openInstructions({ catalog, workspaceRoot, itemsRoot, log });
      const { refresh } = instructions;
      // Written (or a stale one removed) before the server takes POST /agents, so the first agent gets it.
      await refresh();
      instructions.watch();
      const items =
        itemsRoot === undefined || catalog === undefined
          ? {}
          : { items: catalog, writer: refreshingWriter(openWriter({ root: itemsRoot, store, log }), refresh) };
      server = await startServer({
        manager,
        store,
        harnesses,
        workspaceRoot: config.workspaceRoot,
        token,
        port: config.port,
        log,
        // Only called from a request, and none is handled before `stop` below is defined.
        onShutdown: () => stop("POST /shutdown"),
        // The file goes first, while the agents still stop: a start that finds it would take this service for a
        // running one, exit 0, and leave nothing running once this one exits. Without the file it waits for the
        // lock, which this service releases last. A failure here is logged; the stop path tries the removal again.
        onShutdownStart: () => {
          try {
            removeDiscovery(config.discoveryPath, process.pid);
          } catch (error) {
            log("shutdown_step_failed", { step: "discovery", error: error instanceof Error ? error.name : "unknown" });
          }
        },
        ...items,
      });
    } catch (error) {
      throw listenRefusal(config.port, error) ?? error;
    }
    try {
      writeDiscovery(config.discoveryPath, {
        apiVersion: API_VERSION,
        port: server.port,
        pid: process.pid,
        token,
        workspace: config.workspaceRoot,
      });
    } catch (error) {
      throw new StartRefused(
        `The service couldn't write its discovery file ${config.discoveryPath} (${(error as Error).message}). ` +
          "Make sure XDG_RUNTIME_DIR is a folder you can write to, or set it to one, and start the service again.",
      );
    }
  } catch (error) {
    // Best effort: the start failure is what the user needs to see, not a follow-on error from cleaning up.
    await server?.close().catch(() => undefined);
    await instructions?.close().catch(() => undefined);
    await manager?.shutdown().catch(() => undefined);
    try {
      store?.close();
    } catch {
      // The start failure is reported next; a close error on top would only hide it.
    }
    releaseQuietly(lock);
    return fail(error);
  }

  log("service_started", { pid: process.pid, port: server.port, apiVersion: API_VERSION });

  const { discoveryPath } = config;
  const openedStore = store;
  const openedManager = manager;
  const openedServer = server;
  const openedInstructions = instructions;
  const heldLock = lock;
  let stopping: Promise<void> | undefined;
  /** The one stop path, for SIGINT, SIGTERM and POST /shutdown. */
  const stop = (reason: NodeJS.Signals | "POST /shutdown") => {
    stopping ??= (async () => {
      log("service_stopping", { reason });
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
      await step("instructions", () => openedInstructions.close());
      await step("manager", () => openedManager.shutdown());
      await step("store", () => openedStore.close());
      // Last: a start waiting on the lock may open the store as soon as it's gone.
      await step("lock", () => heldLock.release());
      process.exit(failed ? 1 : 0);
    })();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
};

if (import.meta.main) await main();
