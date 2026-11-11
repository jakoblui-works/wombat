// A fake of `window.wombat` for the renderer's data tests (T8): an in-memory agent service behind the bridge's
// `service` calls. GET /agents lists the agents, GET /proposals the proposals, and GET /agents/:id/log?after=&limit=
// reads like the service's store.readLog: the query parsed with ListLogQuery (400 with an ErrorBody when it fails),
// at most `limit` entries above `after` (FAKE_DEFAULT_LIMIT when the read sends none), numbered by one store-wide
// seq, sent through JSON as IPC would; entries of a type the app doesn't know are stored and sent raw; `truncated` is
// true exactly when the cap dropped an entry of this agent after `after` (`capDrop` models the cap). The read-cases
// table (test/log-read-cases.test.ts, shared with the service's own test) keeps this in step with the service.
// Plus alert and connection feeds the test drives. It records the requests it answered, so a test can tell an append
// from a full reload. A test can also make it misbehave the ways the page must survive: refuse while not connected
// (as main does), or ignore `after` for one agent; a log read past MAX_LOG_READS for one agent answers 500, so a
// client that loops fails its test instead of hanging it.
import { type AgentSummary, type Alert, ListLogQuery, type LogEntry } from "@wombat/shared/api";
import type { Proposal } from "@wombat/shared/items";
import type { ConnectionState, WombatBridge } from "../src/shared/bridge.ts";
import { atFor, type Body, summary } from "./log-entries.ts";

export type FakeRequest = { method: string; path: string };

export type FakeService = {
  bridge: WombatBridge;
  /** The current store's id; `newStore()` changes it. */
  dbId: () => string;
  /** Appends bodies to an agent's log under the store-wide seq; returns the stored entries. */
  append: (agentId: string, ...bodies: Body[]) => LogEntry[];
  /** An agent's whole stored log. */
  log: (agentId: string) => LogEntry[];
  /** The cap dropping the agent's oldest entries, through seq `through`. */
  capDrop: (agentId: string, through: number) => void;
  /** A fresh store (another dbId), as after the service's store was replaced: every log is empty, seq restarts. */
  newStore: (dbId: string) => void;
  /** Sends an alert for an agent to every onAlert subscriber, with the current dbId and seq unless given. */
  alert: (type: "agent_added" | "agent_changed" | "agent_removed" | "log", agentId: string, fields?: Partial<Alert>) => void;
  /** Sends a connection state to every onConnection subscriber. */
  connection: (state: ConnectionState["state"]) => void;
  /** Sets fields of an agent's summary (listed by GET /agents from then on, log or not). */
  setAgent: (agentId: string, fields: Partial<AgentSummary>) => void;
  /** Sets the folders GET /repos lists (the workspace root, ".", alone by default). */
  setRepos: (repos: { path: string; name: string }[]) => void;
  /** Adds a proposal to GET /proposals. */
  addProposal: (proposal: Proposal) => void;
  /** Deletes an agent: gone from GET /agents, its log reads answer 404. */
  removeAgent: (agentId: string) => void;
  /** Main's refusal while not connected: request() rejects unless the last connection state is `connected`. */
  refuseWhileDisconnected: (on: boolean) => void;
  /** A misbehaving service: the agent's log reads ignore `after` (always from its first entry). */
  ignoreAfter: (agentId: string) => void;
  /** Every request answered so far. */
  requests: () => FakeRequest[];
  /** Requests started and not answered yet. */
  inFlight: () => number;
};

/** The fake's page size for a read that sends no `limit`: small, so a client relying on the default shows. */
export const FAKE_DEFAULT_LIMIT = 3;

/** Log reads of one agent after which the fake answers 500, so a looping client fails instead of hanging. */
export const MAX_LOG_READS = 50;

const notImplemented = (what: string) => () => {
  throw new Error(`fake bridge: ${what} isn't part of this fake`);
};

export const fakeService = (initialDbId = "db-1"): FakeService => {
  let dbId = initialDbId;
  let seq = 0;
  let logs = new Map<string, LogEntry[]>();
  let droppedThrough = new Map<string, number>();
  const answered: FakeRequest[] = [];
  let pending = 0;
  const alertSubscribers = new Set<(alert: Alert) => void>();
  const connectionSubscribers = new Set<(state: ConnectionState) => void>();
  let state: ConnectionState = { state: "connecting" };
  const agentFields = new Map<string, Partial<AgentSummary>>();
  const ignoringAfter = new Set<string>();
  const logReads = new Map<string, number>();
  let refusing = false;
  const proposals: Proposal[] = [];
  let repos = [{ path: ".", name: "workspace" }];

  const answer = (method: string, path: string): { status: number; body: unknown } => {
    const url = new URL(path, "http://service.invalid");
    if (method === "GET" && url.pathname === "/agents") {
      const ids = [...new Set([...logs.keys(), ...agentFields.keys()])];
      return { status: 200, body: { dbId, seq, agents: ids.map((id) => summary(id, agentFields.get(id))) } };
    }
    if (method === "GET" && url.pathname === "/repos") return { status: 200, body: { repos } };
    if (method === "GET" && url.pathname === "/proposals") return { status: 200, body: { proposals } };
    const logMatch = /^\/agents\/([^/]+)\/log$/.exec(url.pathname);
    if (method === "GET" && logMatch) {
      const agentId = decodeURIComponent(logMatch[1] ?? "");
      const reads = (logReads.get(agentId) ?? 0) + 1;
      logReads.set(agentId, reads);
      if (reads > MAX_LOG_READS) {
        return { status: 500, body: { error: { code: "internal_error", message: `fake: more than ${String(MAX_LOG_READS)} log reads of ${agentId}` } } };
      }
      // The query as the route reads it: a repeated key arrives as a list (and fails), as it does there.
      const raw: Record<string, string | string[]> = {};
      for (const key of new Set(url.searchParams.keys())) {
        const values = url.searchParams.getAll(key);
        raw[key] = values.length === 1 ? (values[0] ?? "") : values;
      }
      const query = ListLogQuery.safeParse(raw);
      if (!query.success) {
        return { status: 400, body: { error: { code: "invalid_request", message: query.error.issues[0]?.message ?? "invalid query" } } };
      }
      const after = ignoringAfter.has(agentId) ? 0 : query.data.after;
      const limit = query.data.limit ?? FAKE_DEFAULT_LIMIT;
      const all = logs.get(agentId) ?? (agentFields.has(agentId) ? [] : undefined);
      if (all === undefined) return { status: 404, body: { error: { code: "not_found", message: `No agent ${agentId}.` } } };
      const dropped = droppedThrough.get(agentId);
      return {
        status: 200,
        body: {
          dbId,
          seq,
          entries: all.filter((entry) => entry.seq > after).slice(0, limit),
          truncated: dropped !== undefined && dropped > after,
        },
      };
    }
    return { status: 404, body: { error: { code: "not_found", message: `${method} ${url.pathname} isn't in this fake.` } } };
  };

  const bridge: WombatBridge = {
    apiVersion: 1,
    service: {
      request: async (method, path) => {
        if (refusing && state.state !== "connected") {
          await Promise.resolve();
          throw new Error(`The service isn't connected (${state.state}); wait until it connects.`);
        }
        pending++;
        try {
          // The service answers as the request arrives; the answer reaches the page on a later turn, as over IPC, so
          // entries stored meanwhile aren't in it and concurrent requests really overlap.
          const result = answer(method, path);
          answered.push({ method, path });
          await new Promise((resolve) => setTimeout(resolve, 0));
          return JSON.parse(JSON.stringify(result)) as { status: number; body: unknown };
        } finally {
          pending--;
        }
      },
      onAlert: (cb) => {
        alertSubscribers.add(cb);
        return () => alertSubscribers.delete(cb);
      },
      onConnection: (cb) => {
        connectionSubscribers.add(cb);
        cb(state);
        return () => connectionSubscribers.delete(cb);
      },
      restart: notImplemented("restart"),
    },
    workspace: { get: notImplemented("workspace.get"), switch: notImplemented("workspace.switch") },
    settings: { get: notImplemented("settings.get"), set: notImplemented("settings.set") },
    onOpenAgent: () => () => undefined,
  };

  return {
    bridge,
    dbId: () => dbId,
    append: (agentId, ...bodies) => {
      const log = logs.get(agentId) ?? [];
      logs.set(agentId, log);
      const added = bodies.map((body) => {
        seq++;
        return { ...body, seq, agentId, at: atFor(seq) };
      });
      log.push(...added);
      return structuredClone(added);
    },
    log: (agentId) => structuredClone(logs.get(agentId) ?? []),
    capDrop: (agentId, through) => {
      logs.set(agentId, (logs.get(agentId) ?? []).filter((entry) => entry.seq > through));
      droppedThrough.set(agentId, Math.max(through, droppedThrough.get(agentId) ?? 0));
    },
    newStore: (next) => {
      dbId = next;
      seq = 0;
      logs = new Map();
      droppedThrough = new Map();
    },
    alert: (type, agentId, fields = {}) => {
      const alert = { seq, dbId, type, agentId, ...fields } as Alert;
      for (const cb of alertSubscribers) cb(alert);
    },
    connection: (next) => {
      state = { state: next };
      for (const cb of connectionSubscribers) cb(state);
    },
    setAgent: (agentId, fields) => {
      agentFields.set(agentId, { ...agentFields.get(agentId), ...fields });
    },
    setRepos: (listed) => {
      repos = listed;
    },
    addProposal: (added) => {
      proposals.push(added);
    },
    removeAgent: (agentId) => {
      agentFields.delete(agentId);
      logs.delete(agentId);
    },
    refuseWhileDisconnected: (on) => {
      refusing = on;
    },
    ignoreAfter: (agentId) => {
      ignoringAfter.add(agentId);
    },
    requests: () => [...answered],
    inFlight: () => pending,
  };
};
