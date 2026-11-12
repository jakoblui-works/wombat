// Main's connection to the service, the page's only way to it. It reads the alert stream and forwards known alerts,
// and follows the service across restarts: on every (re)connect it re-reads the discovery file (a new service may
// be on a new port) and proves it with the file's token. It never starts a service by itself; only `reconnect` with a start does.
import { API_VERSION } from "@wombat/shared";
import { HEARTBEAT_MS, parseAlert, type AgentSummary, type Alert } from "@wombat/shared/api";
import { findRunningService, type DiscoveryFile } from "@wombat/shared/discovery";
import type { ConnectionState, ConnectionUpdate, ServiceAnswer } from "../shared/bridge.ts";
import { callService, listAgents, requestService } from "./service-client.ts";
import { pageMessage, ServiceTooOld } from "./service-start.ts";

export type ConnectionTiming = {
  /** The wait before the second try after a drop; each wait after doubles, up to `maxRetryMs`. */
  firstRetryMs: number;
  maxRetryMs: number;
  /** How long the service may stay gone before the state is `failed`. */
  failAfterMs: number;
  /** A stream with nothing on it (not even the heartbeat) for this long is dropped. */
  stallMs: number;
  /** A stream that ends sooner than this after opening doesn't reset the waits: a service that keeps dropping it backs off. */
  healthyMs: number;
};

const DEFAULT_TIMING: ConnectionTiming = { firstRetryMs: 250, maxRetryMs: 4_000, failAfterMs: 30_000, stallMs: 3 * HEARTBEAT_MS, healthyMs: 15_000 };
const VERSION_TIMEOUT_MS = 2_000;
/** For the stream's response headers; the stream itself has no timeout but the stall. */
const HEADERS_TIMEOUT_MS = 10_000;
/** Alerts are ids only; a stream holding more than this without an event end isn't the service's. */
const MAX_EVENT_CHARS = 64 * 1024;

export type ConnectionDeps = {
  /** The discovery file's path, read again on every try. */
  discoveryFile: () => string;
  onState: (update: ConnectionUpdate) => void;
  onAlert: (alert: Alert) => void;
  timing?: Partial<ConnectionTiming>;
  log?: (line: string) => void;
};

export type ServiceConnection = {
  current: () => ConnectionUpdate;
  /** The page's request, to the connected service (see requestService). */
  request: (method: unknown, path: unknown, body: unknown) => Promise<ServiceAnswer>;
  /**
   * Drops the current connection, runs `start` (a start, restart or switch of the service; its failure is the
   * `failed` state with pageMessage's message, or `incompatible` for a ServiceTooOld), then connects to the service
   * the discovery file names. Settles once the newest reconnect has (connected, incompatible or failed); never rejects.
   */
  reconnect: (start: () => Promise<unknown>) => Promise<void>;
  /** The connected service's agents (for main's own use); rejects while not connected. */
  agents: () => Promise<AgentSummary[]>;
  /**
   * Drops the connection (`connecting`, "Stopping the service…") and runs `stopIt` (a stop of the service), then
   * shows `failed`, with Restart. When `stopIt` fails it connects again (the service may still run) and rejects with
   * its error.
   */
  shutdown: (stopIt: () => Promise<void>) => Promise<void>;
  /** Stops the stream and every retry wait, for good. */
  close: () => void;
};

type Probe = { found: DiscoveryFile } | { incompatible: string } | { missing: true };

/** Where the tries of one outage are: when it began, and the next wait. */
type Retry = { since: number; wait: number };

export const serviceConnection = ({ discoveryFile, onState, onAlert, timing = {}, log = console.warn }: ConnectionDeps): ServiceConnection => {
  const { firstRetryMs, maxRetryMs, failAfterMs, stallMs, healthyMs } = { ...DEFAULT_TIMING, ...timing };
  let update: ConnectionUpdate = { seq: 0, state: { state: "connecting" } };
  let connected: DiscoveryFile | undefined;
  // Each reconnect starts a new run; a loop or stream of an older run stops at its next step.
  let run = 0;
  let stream: AbortController | undefined;
  let newest: Promise<void> = Promise.resolve();
  // The retry waits, so close can end them; an ended wait resolves and its loop stops at the run check.
  const waits = new Map<NodeJS.Timeout, () => void>();
  const delay = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        waits.delete(timer);
        resolve();
      }, ms);
      waits.set(timer, resolve);
    });

  const set = (state: ConnectionState): void => {
    if (state.state === update.state.state && state.message === update.state.message) return;
    update = { seq: update.seq + 1, state };
    onState(update);
  };

  const probe = async (): Promise<Probe> => {
    let file: DiscoveryFile | undefined;
    try {
      // Undefined for a left-over file whose port nothing (or something else) answers on.
      file = await findRunningService(discoveryFile(), { timeoutMs: VERSION_TIMEOUT_MS });
    } catch {
      return { missing: true };
    }
    if (file === undefined) return { missing: true };
    if (file.apiVersion === API_VERSION) return { found: file };
    return {
      incompatible:
        `The running service speaks API version ${String(file.apiVersion)}; this app needs version ${String(API_VERSION)}. ` +
        "Restart stops that service and its agents and starts this app's own service.",
    };
  };

  const forward = (block: string): void => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data === "") return;
    try {
      const alert = parseAlert(JSON.parse(data));
      if (alert !== undefined) onAlert(alert);
    } catch {
      // The alert's content stays out of the log: it's the service's to describe.
      log("An alert from the service didn't parse; dropped it.");
    }
  };

  /** Reads the stream until it ends, errors, stalls or holds an event too long to be an alert. */
  const read = async (body: ReadableStream<Uint8Array>, controller: AbortController): Promise<void> => {
    let stall = setTimeout(() => controller.abort(), stallMs);
    let buffer = "";
    try {
      for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
        clearTimeout(stall);
        stall = setTimeout(() => controller.abort(), stallMs);
        buffer += chunk.replaceAll("\r\n", "\n");
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          forward(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
        }
        if (buffer.length > MAX_EVENT_CHARS) {
          log("The service's alert stream sent an event too long to be an alert; dropped the connection.");
          controller.abort();
          return;
        }
      }
    } catch {
      // Ended by the service going away, a stall or a reconnect: all the same here.
    } finally {
      clearTimeout(stall);
    }
  };

  /** Opens the alert stream; true once it's open and `connected` is set (it's then read in the background). */
  const open = async (file: DiscoveryFile, mine: number, retry: Retry): Promise<boolean> => {
    const controller = new AbortController();
    // Kept before the call, so a reconnect can abort an open that hangs before its headers.
    stream = controller;
    const headers = setTimeout(() => controller.abort(), HEADERS_TIMEOUT_MS);
    let body: ReadableStream<Uint8Array> | undefined;
    try {
      const response = await callService(file, "GET", "/events", { signal: controller.signal });
      if (response.status === 200 && response.body !== null) body = response.body;
      else await response.body?.cancel();
    } catch {
      // Refused, aborted or timed out: another try.
    } finally {
      clearTimeout(headers);
    }
    if (body === undefined || mine !== run) {
      controller.abort();
      if (stream === controller) stream = undefined;
      return false;
    }
    connected = file;
    const openedAt = Date.now();
    // Connected only once the stream is open, so no alert after it is missed.
    set({ state: "connected" });
    void read(body, controller).then(() => {
      if (mine !== run) return;
      connected = undefined;
      stream = undefined;
      set({ state: "reconnecting" });
      // After a long healthy stream, at once and with fresh waits; after a short one, the outage goes on.
      if (Date.now() - openedAt >= healthyMs) void connect(mine);
      else void connect(mine, retry, true);
    });
    return true;
  };

  /** Tries until connected, incompatible, or the service has stayed gone (or kept dropping) for `failAfterMs`. */
  const connect = async (mine: number, retry: Retry = { since: Date.now(), wait: firstRetryMs }, waitFirst = false): Promise<void> => {
    let { wait } = retry;
    let pause = waitFirst;
    for (;;) {
      if (pause) {
        if (Date.now() - retry.since >= failAfterMs) {
          set({
            state: "failed",
            message: `The service stopped, or kept dropping the connection, for ${String(Math.round(failAfterMs / 1000))} s. Restart it to start it again.`,
          });
          return;
        }
        await delay(wait);
        if (mine !== run) return;
        wait = Math.min(wait * 2, maxRetryMs);
      }
      pause = true;
      const found = await probe();
      if (mine !== run) return;
      if ("incompatible" in found) {
        set({ state: "incompatible", message: found.incompatible });
        return;
      }
      if ("found" in found && (await open(found.found, mine, { since: retry.since, wait }))) return;
      if (mine !== run) return;
    }
  };

  const stop = (): number => {
    run += 1;
    stream?.abort();
    stream = undefined;
    connected = undefined;
    return run;
  };

  const attempt = async (mine: number, start: () => Promise<unknown>): Promise<void> => {
    try {
      await start();
    } catch (error) {
      if (mine !== run) return;
      log(`The service isn't running: ${error instanceof Error ? error.message : String(error)}`);
      set({ state: error instanceof ServiceTooOld ? "incompatible" : "failed", message: pageMessage(error) });
      return;
    }
    if (mine === run) await connect(mine);
  };

  return {
    current: () => update,
    request: (method, pathname, body) => requestService(connected, method, pathname, body),
    agents: () => (connected === undefined ? Promise.reject(new Error("The service isn't connected.")) : listAgents(connected)),
    shutdown: async (stopIt) => {
      const mine = stop();
      set({ state: "connecting", message: "Stopping the service…" });
      try {
        await stopIt();
      } catch (error) {
        if (mine === run) {
          // The service may still run: no longer "Stopping the service…" while it's found again.
          set({ state: "connecting" });
          newest = connect(mine);
        }
        throw error;
      }
      if (mine === run) set({ state: "failed", message: "The service and its agents are stopped. Restart it to start it again." });
    },
    reconnect: async (start) => {
      const mine = stop();
      set({ state: "connecting" });
      let awaited = attempt(mine, start);
      newest = awaited;
      await awaited;
      // Overtaken by a later reconnect: settle with it, not before.
      while (newest !== awaited) {
        awaited = newest;
        await awaited;
      }
    },
    close: () => {
      stop();
      for (const [timer, resolve] of waits) {
        clearTimeout(timer);
        resolve();
      }
      waits.clear();
    },
  };
};
