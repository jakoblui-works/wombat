import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { getRequestListener } from "@hono/node-server";
import { API_VERSION } from "@wombat/shared";
import {
  AnswerPermissionRequest,
  ListLogQuery,
  SendMessageRequest,
  StartAgentRequest,
  type ErrorBody,
  type ListAgentsResponse,
  type ListHarnessesResponse,
  type ListLogResponse,
  type VersionResponse,
} from "@wombat/shared/api";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

import { AgentError, logToStderr, type AgentErrorCode, type Log, type Manager } from "../agents/manager.ts";
import type { Harness } from "../harness/harness.ts";
import type { Store } from "../store/store.ts";
import { errorResponse } from "./errors.ts";
import { createAlertStreams } from "./events.ts";
import { portRules } from "./port-rules.ts";

export type ServerOptions = {
  manager: Manager;
  store: Store;
  harnesses: readonly Harness[];
  /** The bearer token every request must carry. */
  token: string;
  /** 0 (the default) picks a free port. */
  port?: number;
  heartbeatMs?: number;
  /** The log route's limit when the request sends none. */
  defaultLogLimit?: number;
  /** Ids and names only, like the manager's log. */
  log?: Log;
};

const MAX_BODY_BYTES = 1024 * 1024;
/** Shorter tokens are guessable by a local process that can try requests in a loop. */
const MIN_TOKEN_LENGTH = 16;
/** How long close() lets ended responses flush before it drops the connections left. */
const CLOSE_GRACE_MS = 1_000;

const STATUS: Record<AgentErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  busy: 409,
  not_running: 409,
  kind_not_offered: 422,
  unknown_harness: 422,
  repo_not_found: 422,
  repo_outside_workspace: 422,
  auth_required: 502,
  agent_failed: 502,
};

/** Thrown by a route on a request that breaks the contract; answered with 400. */
class InvalidRequest extends Error {}

const describeIssues = (error: z.ZodError) =>
  error.issues
    .map((issue) => (issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`))
    .join("; ");

/** The request body as JSON, whatever its Content-Type says, checked against `schema`. */
const readBody = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> => {
  const text = await c.req.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InvalidRequest("The request body isn't JSON. Send a JSON object as described in the API contract.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidRequest(
      `The request body doesn't match the API contract (${describeIssues(parsed.error)}). Fix it and send it again.`,
    );
  }
  return parsed.data;
};

/** Every value of every query key: a repeated key stays an array, so the strict query schema refuses it. */
const queryValues = (c: Context) =>
  Object.fromEntries(
    Object.entries(c.req.queries()).map(([key, values]) => [key, values.length === 1 ? values[0] : values]),
  );

/** Serves the API on 127.0.0.1 only; resolves once it is listening. */
export const startServer = async ({
  manager,
  store,
  harnesses,
  token,
  port = 0,
  heartbeatMs = 15_000,
  defaultLogLimit = 1000,
  log = logToStderr,
}: ServerOptions): Promise<{ port: number; close: () => Promise<void> }> => {
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `The service token is ${token.length} characters long; it needs at least ${MIN_TOKEN_LENGTH}. Start the service with a longer random token.`,
    );
  }
  // Known once listening; no request is handled before then.
  let boundPort = 0;
  const alerts = createAlertStreams({ onCommitted: manager.onCommitted, dbId: store.dbId, heartbeatMs });
  const app = new Hono();

  app.use(portRules({ token, port: () => boundPort }));
  app.use(
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        errorResponse(c, 413, "payload_too_large", "The request body is over 1 MiB. Send a shorter message."),
    }),
  );

  app.get("/version", (c) => c.json({ apiVersion: API_VERSION } satisfies VersionResponse));

  app.get("/harnesses", (c) =>
    c.json(harnesses.map(({ id, name }) => ({ id, name })) satisfies ListHarnessesResponse),
  );

  app.get("/agents", (c) =>
    c.json({ dbId: store.dbId, seq: store.currentSeq(), agents: store.listAgents() } satisfies ListAgentsResponse),
  );

  app.post("/agents", async (c) => {
    const { harness, repo } = await readBody(c, StartAgentRequest);
    return c.json(await manager.start(harness, repo), 201);
  });

  app.get("/agents/:id/log", (c) => {
    const query = ListLogQuery.safeParse(queryValues(c));
    if (!query.success) {
      throw new InvalidRequest(
        `The query doesn't match the API contract (${describeIssues(query.error)}). Fix it and send it again.`,
      );
    }
    const agentId = c.req.param("id");
    if (!store.listAgents().some((agent) => agent.id === agentId)) {
      return errorResponse(c, 404, "not_found", `There's no agent ${agentId}. List the agents to see which exist.`);
    }
    const { after, limit = defaultLogLimit } = query.data;
    const { entries, truncated } = store.readLog(agentId, after, limit);
    return c.json({ dbId: store.dbId, seq: store.currentSeq(), entries, truncated } satisfies ListLogResponse);
  });

  app.post("/agents/:id/messages", async (c) => {
    const message = await readBody(c, SendMessageRequest);
    return c.json(await manager.send(c.req.param("id"), message), 202);
  });

  app.post("/agents/:id/permissions/:requestId", async (c) => {
    const { kind } = await readBody(c, AnswerPermissionRequest);
    manager.answer(c.req.param("id"), c.req.param("requestId"), kind);
    return c.body(null, 204);
  });

  app.post("/agents/:id/cancel", async (c) => {
    await manager.cancel(c.req.param("id"));
    return c.body(null, 202);
  });

  app.post("/agents/:id/stop", async (c) => {
    await manager.stop(c.req.param("id"));
    return c.body(null, 204);
  });

  app.delete("/agents/:id", async (c) => {
    await manager.delete(c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/events", (c) => {
    // Hono answers HEAD by running this handler and dropping the body, which would leave a subscription that
    // no client ever reads or cancels.
    if (c.req.method === "HEAD") {
      c.header("allow", "GET");
      return errorResponse(c, 405, "method_not_allowed", "The alert stream only answers GET. Open it with GET /events.");
    }
    return alerts.respond();
  });

  app.notFound((c) =>
    errorResponse(
      c,
      404,
      "not_found",
      `There's no route ${c.req.method} ${c.req.path}. See the API contract for the routes.`,
    ),
  );

  app.onError((error, c) => {
    if (error instanceof InvalidRequest) return errorResponse(c, 400, "invalid_request", error.message);
    if (error instanceof AgentError) return errorResponse(c, STATUS[error.code], error.code, error.message, error.hint);
    // The details stay in the service: an error's message may quote agent content or paths.
    log("request_failed", { method: c.req.method, route: c.req.routePath, error: error.name });
    return errorResponse(
      c,
      500,
      "internal_error",
      "The agent service failed to handle the request. Try again; if it keeps failing, restart the service.",
    );
  });

  const listener = getRequestListener(app.fetch, {
    // A request the adapter can't turn into a URL (a malformed Host or path) never reaches the routes.
    errorHandler: () => {
      const body: ErrorBody = {
        error: {
          code: "invalid_request",
          message: "The request's Host header or path is malformed. Send a well-formed request.",
        },
      };
      return Response.json(body, { status: 400 });
    },
  });
  // The listener handles its own failures; the server only needs it started.
  const server = createServer((incoming, outgoing) => void listener(incoming, outgoing));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  boundPort = (server.address() as AddressInfo).port;

  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      alerts.closeAll();
      server.closeIdleConnections();
      // A connection still busy after the grace (a slow client) must not keep close() waiting.
      const timer = setTimeout(() => server.closeAllConnections(), CLOSE_GRACE_MS);
      server.once("close", () => clearTimeout(timer));
    }));

  return { port: boundPort, close };
};
