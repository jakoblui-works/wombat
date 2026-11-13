// Shared setup for the server tests: the agent manager fixture (fake agents, temp store and workspace) behind a
// real server on 127.0.0.1 and an ephemeral port, plus a raw HTTP client and an SSE reader on node:http, so
// tests control every header (Host and Origin included). Every response is checked for CORS headers, which the
// service must never send.
import { randomBytes } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";

import { APP_ORIGIN } from "@wombat/shared";
import { ErrorBody } from "@wombat/shared/api";
import { expect, onTestFinished } from "vitest";

import { openCatalog } from "../src/items/catalog.ts";
import { openWriter } from "../src/items/write.ts";
import { startServer } from "../src/server/server.ts";
import { fixtureHarnesses, REPO, setup, WAIT_MS, type Setup, type SetupOptions } from "./manager-fixtures.ts";

export { APP_ORIGIN };

/**
 * Every route of the app's contract, on a real agent and request id, plus a path no route has: the port rules
 * apply to each, and an agent token opens none of them. app-routes.test.ts checks it covers every APP_ROUTES entry.
 */
export const appRoutes = (agentId: string): { method: string; path: string; body?: unknown }[] => [
  { method: "GET", path: "/version" },
  { method: "GET", path: "/harnesses" },
  { method: "GET", path: "/repos" },
  { method: "GET", path: "/agents" },
  { method: "POST", path: "/agents", body: { harness: "fake-reply", repo: REPO } },
  { method: "GET", path: `/agents/${agentId}/log` },
  { method: "POST", path: `/agents/${agentId}/messages`, body: { text: "Refused prompt" } },
  { method: "POST", path: `/agents/${agentId}/permissions/req_1`, body: { kind: "allow_once" } },
  { method: "POST", path: `/agents/${agentId}/config`, body: { configId: "model", value: "fake-small" } },
  { method: "POST", path: `/agents/${agentId}/context` },
  { method: "POST", path: `/agents/${agentId}/cancel` },
  { method: "POST", path: `/agents/${agentId}/stop` },
  { method: "DELETE", path: `/agents/${agentId}` },
  { method: "POST", path: "/shutdown" },
  { method: "GET", path: "/events" },
  { method: "GET", path: "/structures" },
  { method: "GET", path: "/structures/bugs/items" },
  { method: "GET", path: "/items/BUG-1" },
  { method: "GET", path: "/proposals" },
  { method: "POST", path: "/proposals/prop_1/approve" },
  { method: "POST", path: "/proposals/prop_1/reject" },
  { method: "GET", path: "/no-such-route" },
];

export type Response = {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  /** The body parsed as JSON; undefined when it is empty or isn't JSON. */
  json: unknown;
};

export type RequestOptions = {
  method?: string;
  path: string;
  /** Sent as is; `host` and `authorization` are set by the options below unless given here. */
  headers?: Record<string, string>;
  /** An object is sent as JSON (with a JSON content type); a string or Buffer as is. */
  body?: unknown;
  /** The Host header: default `127.0.0.1:<port>`; null sends none. */
  host?: string | null;
};

/** Fails the test if a response carries any CORS header. */
const expectNoCors = (headers: IncomingHttpHeaders, what: string) => {
  expect(
    Object.keys(headers).filter((name) => name.toLowerCase().startsWith("access-control-")),
    `CORS headers on ${what}`,
  ).toEqual([]);
};

const encodeBody = (body: unknown): { data: Buffer | undefined; json: boolean } => {
  if (body === undefined) return { data: undefined, json: false };
  if (typeof body === "string") return { data: Buffer.from(body), json: false };
  if (Buffer.isBuffer(body)) return { data: body, json: false };
  return { data: Buffer.from(JSON.stringify(body)), json: true };
};

const send = (port: number, options: RequestOptions) => {
  const { method = "GET", path, headers = {}, body, host = `127.0.0.1:${port}` } = options;
  const { data, json } = encodeBody(body);
  const all: Record<string, string> = {
    ...(host === null ? {} : { host }),
    ...(json ? { "content-type": "application/json" } : {}),
    ...(data === undefined ? {} : { "content-length": String(data.length) }),
    ...headers,
  };
  const req = httpRequest({ host: "127.0.0.1", port, method, path, headers: all, setHost: false });
  return { req, data };
};

/** One plain HTTP request; fails after WAIT_MS. */
export const rawRequest = (port: number, options: RequestOptions): Promise<Response> =>
  new Promise((resolve, reject) => {
    const { req, data } = send(port, options);
    const what = `${options.method ?? "GET"} ${options.path}`;
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`timed out waiting for the response to ${what}`));
    }, WAIT_MS);
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: unknown;
        try {
          parsed = text === "" ? undefined : JSON.parse(text);
        } catch {
          parsed = undefined;
        }
        try {
          expectNoCors(res.headers, what);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: parsed });
      });
    });
    req.end(data);
  });

/** One server-sent event as read off the wire: its fields, or a comment line. */
export type SseEvent = { id: string | undefined; event: string | undefined; data: string };

export type Stream = {
  status: number;
  headers: IncomingHttpHeaders;
  /** Every byte received so far, as text. */
  raw: () => string;
  /** Dispatched events (a blank line ends one), in order. */
  events: () => SseEvent[];
  /** Comment lines (`: text` → `text`), in order. */
  comments: () => string[];
  /** True once the server ended the response. */
  ended: () => boolean;
  /** Waits until `check` is true; fails with `what` after WAIT_MS. */
  until: (what: string, check: (stream: Stream) => boolean) => Promise<void>;
  /** Drops the connection from the client side. */
  close: () => void;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Opens `GET /events` and resolves once the response headers arrived (also for a refusal). */
export const openStream = (port: number, options: Omit<RequestOptions, "path" | "method"> = {}): Promise<Stream> =>
  new Promise((resolve, reject) => {
    const { req, data } = send(port, { ...options, path: "/events" });
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("timed out waiting for the /events response headers"));
    }, WAIT_MS);
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.on("response", (res: IncomingMessage) => {
      clearTimeout(timer);
      try {
        expectNoCors(res.headers, "GET /events");
      } catch (error) {
        req.destroy();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      let raw = "";
      let pending = "";
      let ended = false;
      const events: SseEvent[] = [];
      const comments: string[] = [];
      let current: { id?: string; event?: string; data: string[] } = { data: [] };
      const line = (text: string) => {
        if (text === "") {
          if (current.data.length > 0 || current.id !== undefined || current.event !== undefined) {
            events.push({ id: current.id, event: current.event, data: current.data.join("\n") });
          }
          current = { data: [] };
          return;
        }
        if (text.startsWith(":")) {
          comments.push(text.slice(1).replace(/^ /, ""));
          return;
        }
        const colon = text.indexOf(":");
        const field = colon === -1 ? text : text.slice(0, colon);
        const value = colon === -1 ? "" : text.slice(colon + 1).replace(/^ /, "");
        if (field === "data") current.data.push(value);
        else if (field === "id") current.id = value;
        else if (field === "event") current.event = value;
      };
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        raw += chunk;
        pending += chunk;
        const lines = pending.split(/\r\n|\r|\n/);
        pending = lines.pop() ?? "";
        for (const text of lines) line(text);
      });
      res.on("end", () => (ended = true));
      res.on("close", () => (ended = true));
      res.on("error", () => (ended = true));
      const stream: Stream = {
        status: res.statusCode ?? 0,
        headers: res.headers,
        raw: () => raw,
        events: () => [...events],
        comments: () => [...comments],
        ended: () => ended,
        until: async (what, check) => {
          const deadline = Date.now() + WAIT_MS;
          while (!check(stream)) {
            if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; stream so far: ${raw}`);
            await sleep(10);
          }
        },
        close: () => req.destroy(),
      };
      onTestFinished(() => {
        req.destroy();
      });
      resolve(stream);
    });
    req.end(data);
  });

export type ServeOptions = SetupOptions & {
  heartbeatMs?: number;
  /** A send that fails this way, as a broken store or agent below the manager would make it. */
  sendFails?: Error;
  /**
   * An items root: the server gets a catalog and a writer on it (on the fixture's store), for the items and
   * proposal routes and the agents' /mcp tools; without it they aren't configured.
   */
  itemsRoot?: string;
  /** Stub agent tokens (token → agent id) /mcp takes besides the live agents' own, so a test needs no agent for one. */
  agentTokens?: Record<string, string>;
};

export type Served = Setup & {
  port: number;
  token: string;
  /** A request with the token, the app's Origin and the right Host, unless the options override them. */
  api: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>;
  request: (options: RequestOptions) => Promise<Response>;
  stream: (options?: Omit<RequestOptions, "path" | "method">) => Promise<Stream>;
  close: () => Promise<void>;
  /** How many of the server's onCommitted subscriptions are live (subscribed and not yet unsubscribed). */
  subscriptions: () => number;
  /** How often the server asked to shut down: its onShutdown hook or the manager's shutdown. */
  shutdownRequests: () => number;
};

/** A manager fixture behind a running server; everything is torn down after the test. */
export const serve = async ({ heartbeatMs, sendFails, itemsRoot, agentTokens = {}, ...setupOptions }: ServeOptions = {}): Promise<Served> => {
  const t = setup(setupOptions);
  const token = randomBytes(24).toString("base64url");
  const harnesses = fixtureHarnesses(t.pidDir);
  // The server gets the manager with onCommitted counted, so tests can see subscriptions it leaves behind, and with
  // the stub agent tokens.
  let live = 0;
  // Counted rather than run for the hook: the real one exits the process.
  let shutdownRequests = 0;
  const manager: Setup["manager"] = {
    ...t.manager,
    ...(sendFails === undefined ? {} : { send: () => Promise.reject(sendFails) }),
    shutdown: () => {
      shutdownRequests += 1;
      return t.manager.shutdown();
    },
    agentForToken: (sent) => (Object.hasOwn(agentTokens, sent) ? agentTokens[sent] : t.manager.agentForToken(sent)),
    onCommitted: (listener) => {
      live += 1;
      const unsubscribe = t.manager.onCommitted(listener);
      let done = false;
      return () => {
        if (!done) {
          done = true;
          live -= 1;
        }
        unsubscribe();
      };
    },
  };
  const server = await startServer({
    manager,
    store: t.store,
    harnesses,
    workspaceRoot: t.root,
    token,
    log: (event, fields) => t.logs.push({ event, fields }),
    onShutdown: () => {
      shutdownRequests += 1;
    },
    ...(heartbeatMs === undefined ? {} : { heartbeatMs }),
    ...(itemsRoot === undefined
      ? {}
      : { items: openCatalog({ root: itemsRoot, store: t.store }), writer: openWriter({ root: itemsRoot, store: t.store }) }),
  });
  let closed: Promise<void> | undefined;
  const close = () => (closed ??= server.close());
  onTestFinished(async () => {
    try {
      await close();
    } catch {
      // Closed by the test, or broken; the manager fixture kills what's left.
    }
  });
  const authorized = (headers: Record<string, string> = {}) => ({
    authorization: `Bearer ${token}`,
    origin: APP_ORIGIN,
    ...headers,
  });
  const served = Object.create(t) as Served;
  return Object.assign(served, {
    port: server.port,
    token,
    subscriptions: () => live,
    shutdownRequests: () => shutdownRequests,
    api: (method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
      rawRequest(server.port, { method, path, body, headers: authorized(headers) }),
    request: (options: RequestOptions) => rawRequest(server.port, options),
    stream: (options: Omit<RequestOptions, "path" | "method"> = {}) =>
      openStream(server.port, { ...options, headers: authorized(options.headers) }),
    close,
  });
};

/** Asserts an error response: the status, an ErrorBody with `code`, and a message that says something. */
export const expectError = (response: Response, status: number, code: string, what = "") => {
  const label = `${what} → ${response.status} ${response.text}`;
  expect(response.status, label).toBe(status);
  const body = ErrorBody.safeParse(response.json);
  expect(body.success, label).toBe(true);
  expect(body.data?.error.code, label).toBe(code);
  expect(body.data?.error.message.trim().length, label).toBeGreaterThan(0);
};
