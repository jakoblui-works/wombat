import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { API_VERSION } from "@wombat/shared";
import {
  AnswerPermissionRequest,
  BODY_OVER_CAP_MESSAGE,
  GetItemResponse as GetItemSchema,
  HEARTBEAT_MS,
  ItemsErrorCode,
  ListItemsResponse as ListItemsSchema,
  ListLogQuery,
  ListProposalsQuery,
  ListProposalsResponse as ListProposalsSchema,
  ListStructuresResponse as ListStructuresSchema,
  SendMessageRequest,
  ServerErrorCode,
  SetConfigRequest,
  StartAgentRequest,
  type AgentSummary,
  type ContextBreakdown,
  type ErrorBody,
  type GetItemResponse,
  type ListAgentsResponse,
  type ListHarnessesResponse,
  type ListItemsResponse,
  type ListLogResponse,
  type ListProposalsResponse,
  type ListReposResponse,
  type ListStructuresResponse,
  type ProposalErrorCode,
  type VersionResponse,
} from "@wombat/shared/api";
import { Proposal as ProposalSchema, type Proposal } from "@wombat/shared/items";
import { MAX_BODY_BYTES } from "@wombat/shared/routes";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";

import { AgentError, notFound, type Manager } from "../agents/manager.ts";
import { openAccess, ProposalError } from "../items/access.ts";
import { handlesById, summarize, withLinks } from "../items/api-view.ts";
import { findByHandle, type Catalog } from "../items/catalog.ts";
import type { Writer } from "../items/write.ts";
import type { Harness } from "../harness/harness.ts";
import { harnessFeatures } from "../harness/registry.ts";
import { logToStderr, type Log } from "../log.ts";
import type { Store } from "../store/store.ts";
import { listRepos, RepoError } from "../workspace.ts";
import { AGENT_STATUS, errorResponse, ITEMS_STATUS, SERVER_STATUS } from "./errors.ts";
import { createAlertStreams } from "./events.ts";
import { mcpRoutes } from "./mcp.ts";
import { portRules } from "./port-rules.ts";

export type ServerOptions = {
  manager: Manager;
  store: Store;
  harnesses: readonly Harness[];
  /** The workspace's root, for `GET /repos`. */
  workspaceRoot: string;
  /** The bearer token every request must carry. */
  token: string;
  /** 0 (the default) picks a free port. */
  port?: number;
  heartbeatMs?: number;
  /** The log route's limit when the request sends none. */
  defaultLogLimit?: number;
  /** Ids and names only, like the manager's log. */
  log?: Log;
  /** The items; without it the items routes answer items_not_configured. */
  items?: Catalog;
  /** Writes the items; with `items`, it opens the agents' write tools on /mcp. */
  writer?: Writer;
  /**
   * Called once POST /shutdown has stopped every agent and its response is out: the service's own stop path,
   * which main passes. Without it the route still stops the agents, but the service keeps running.
   */
  onShutdown?: () => void;
  /** Called when POST /shutdown begins, before any agent is stopped; main removes the discovery file there. */
  onShutdownStart?: () => void;
  /** When the service started and which code it runs (codeIdOf its checkout), for `GET /version`; main sets both once. */
  identity?: { startedAt: string; codeId: string };
};

/** Shorter tokens are guessable by a local process that can try requests in a loop. */
const MIN_TOKEN_LENGTH = 16;
/** How long close() lets ended responses flush before it drops the connections left. */
const CLOSE_GRACE_MS = 1_000;

/** Thrown by a route on a request that breaks the contract; answered with invalid_request. */
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
  workspaceRoot,
  token,
  port = 0,
  heartbeatMs = HEARTBEAT_MS,
  defaultLogLimit = 1000,
  log = logToStderr,
  items,
  writer,
  onShutdown,
  onShutdownStart,
  identity,
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
  /** A stored summary with the agent's live cache state, which is never stored (D19); the only place it is added. */
  const withLiveCache = (agent: AgentSummary): AgentSummary => {
    const cache = manager.liveCache(agent.id);
    return cache === undefined ? agent : { ...agent, cache };
  };
  // Proposal changes reach the alert stream through the manager's listeners, like agent changes.
  const access =
    items && writer
      ? openAccess({ catalog: items, writer, store, onProposal: (id, seq) => manager.proposalCommitted(id, seq), log })
      : undefined;

  // Before the port rules: /mcp takes an agent's token, never the app's, and the port rules refuse agent tokens.
  app.route(
    "/",
    mcpRoutes({
      access,
      agentForToken: manager.agentForToken,
      port: () => boundPort,
      maxBodyBytes: MAX_BODY_BYTES,
      log,
    }),
  );
  app.use(portRules({ token, port: () => boundPort }));
  app.use(
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        errorResponse(c, SERVER_STATUS.payload_too_large, ServerErrorCode.enum.payload_too_large, BODY_OVER_CAP_MESSAGE),
    }),
  );

  app.get("/version", (c) => c.json({ apiVersion: API_VERSION, ...identity } satisfies VersionResponse));

  app.get("/harnesses", (c) =>
    c.json(harnesses.map((harness) => ({ id: harness.id, name: harness.name, features: harnessFeatures(harness) })) satisfies ListHarnessesResponse),
  );

  app.get("/repos", (c) => c.json({ repos: listRepos(workspaceRoot) } satisfies ListReposResponse));

  app.get("/agents", (c) =>
    c.json({ dbId: store.dbId, seq: store.currentSeq(), agents: store.listAgents().map(withLiveCache) } satisfies ListAgentsResponse),
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
      throw notFound(agentId);
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

  // 204 once the agent's new options are stored: a read of the log right after holds them.
  app.post("/agents/:id/config", async (c) => {
    const { configId, value } = await readBody(c, SetConfigRequest);
    await manager.setConfig(c.req.param("id"), configId, value);
    return c.body(null, 204);
  });

  // A hidden turn: the breakdown, with nothing of the turn in the agent's log or summary.
  app.post("/agents/:id/context", async (c) => c.json(await manager.contextBreakdown(c.req.param("id")) satisfies ContextBreakdown));

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

  app.post("/shutdown", async (c) => {
    if ((await c.req.text()) !== "") {
      throw new InvalidRequest("POST /shutdown takes no body. Send it again without one.");
    }
    onShutdownStart?.();
    // Attached before the agents are stopped, so the service stops even if the client leaves meanwhile (its
    // close would come before anything attached later). It fires once the answer is out or the client is gone;
    // the stop path awaits the same manager shutdown before it closes the store.
    if (onShutdown) (c.env as HttpBindings).outgoing.once("close", onShutdown);
    // The manager's shutdown is the stop path's own agent stop: each agent ends as POST /agents/:id/stop ends it.
    await manager.shutdown();
    return c.json({}, 202);
  });

  const notConfigured = (c: Context) =>
    errorResponse(
      c,
      ITEMS_STATUS.items_not_configured,
      ItemsErrorCode.enum.items_not_configured,
      "The items aren't set up. Set WOMBAT_ITEMS to the absolute path of the items folder and restart the service.",
    );

  /** Checked against the shared schema before it goes out, so a drift fails here and not in the app. */
  const checked = <T extends z.ZodType>(schema: T, value: unknown): z.output<T> => schema.parse(value);

  app.get("/structures", async (c) => {
    if (!items) return notConfigured(c);
    const { structures, items: all } = await items.snapshot();
    const body = { structures: structures.map((structure) => summarize(structure, all)) };
    return c.json(checked(ListStructuresSchema, body) satisfies ListStructuresResponse);
  });

  app.get("/structures/:id/items", async (c) => {
    if (!items) return notConfigured(c);
    const id = c.req.param("id");
    const { structures, items: all } = await items.snapshot();
    if (!structures.some((structure) => structure.id === id)) {
      return errorResponse(
        c,
        ITEMS_STATUS.structure_not_found,
        ItemsErrorCode.enum.structure_not_found,
        `There's no structure ${id}. List the structures to see which exist.`,
      );
    }
    const handles = handlesById(all);
    // The schema drops each item's body: a list carries none.
    const listed = all.filter((item) => item.structure === id).map((item) => withLinks(item, structures, handles));
    return c.json(checked(ListItemsSchema, { items: listed }) satisfies ListItemsResponse);
  });

  app.get("/items/:handle", async (c) => {
    if (!items) return notConfigured(c);
    const handle = c.req.param("handle");
    const { structures, items: all } = await items.snapshot();
    const found = findByHandle(all, handle);
    if (!found) {
      return errorResponse(
        c,
        ITEMS_STATUS.item_not_found,
        ItemsErrorCode.enum.item_not_found,
        `There's no item ${handle}. List a structure's items to see their handles.`,
      );
    }
    const handles = handlesById(all);
    return c.json(checked(GetItemSchema, withLinks(found, structures, handles)) satisfies GetItemResponse);
  });

  app.get("/proposals", async (c) => {
    if (!access) return notConfigured(c);
    const parsed = ListProposalsQuery.safeParse(queryValues(c));
    if (!parsed.success) {
      throw new InvalidRequest(`The query doesn't match the API contract (${describeIssues(parsed.error)}). Fix it and send it again.`);
    }
    const proposals = await access.proposals(parsed.data.status);
    return c.json(checked(ListProposalsSchema, { proposals }) satisfies ListProposalsResponse);
  });

  app.post("/proposals/:id/approve", async (c) => {
    if (!access) return notConfigured(c);
    return c.json(checked(ProposalSchema, await access.approve(c.req.param("id"))) satisfies Proposal);
  });

  app.post("/proposals/:id/reject", async (c) => {
    if (!access) return notConfigured(c);
    return c.json(checked(ProposalSchema, await access.reject(c.req.param("id"))) satisfies Proposal);
  });

  app.get("/events", (c) => {
    // Hono answers HEAD by running this handler and dropping the body, which would leave a subscription that
    // no client ever reads or cancels.
    if (c.req.method === "HEAD") {
      c.header("allow", "GET");
      return errorResponse(c, SERVER_STATUS.method_not_allowed, ServerErrorCode.enum.method_not_allowed, "The alert stream only answers GET. Open it with GET /events.");
    }
    return alerts.respond();
  });

  app.notFound((c) =>
    errorResponse(
      c,
      SERVER_STATUS.not_found,
      ServerErrorCode.enum.not_found,
      `There's no route ${c.req.method} ${c.req.path}. See the API contract for the routes.`,
    ),
  );

  app.onError((error, c) => {
    if (error instanceof InvalidRequest) return errorResponse(c, SERVER_STATUS.invalid_request, ServerErrorCode.enum.invalid_request, error.message);
    if (error instanceof ProposalError) return errorResponse(c, ITEMS_STATUS[error.code satisfies ProposalErrorCode], error.code, error.message);
    if (error instanceof RepoError) return errorResponse(c, AGENT_STATUS[error.code], error.code, error.message);
    if (error instanceof AgentError) {
      const status = error.code === ServerErrorCode.enum.invalid_request ? SERVER_STATUS.invalid_request : AGENT_STATUS[error.code];
      return errorResponse(c, status, error.code, error.message, error.hint);
    }
    // The details stay in the service: an error's message may quote agent content or paths.
    log("request_failed", { method: c.req.method, route: c.req.routePath, error: error.name });
    return errorResponse(
      c,
      SERVER_STATUS.internal_error,
      ServerErrorCode.enum.internal_error,
      "The agent service failed to handle the request. Try again; if it keeps failing, restart the service.",
    );
  });

  const listener = getRequestListener(app.fetch, {
    // A request the adapter can't turn into a URL (a malformed Host or path) never reaches the routes.
    errorHandler: () => {
      const body: ErrorBody = {
        error: {
          code: ServerErrorCode.enum.invalid_request,
          message: "The request's Host header or path is malformed. Send a well-formed request.",
        },
      };
      return Response.json(body, { status: SERVER_STATUS.invalid_request });
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
  manager.setMcpUrl(`http://127.0.0.1:${boundPort}/mcp`);

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
