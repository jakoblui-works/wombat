import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { getRequestListener } from "@hono/node-server";
import { API_VERSION } from "@wombat/shared";
import {
  AnswerPermissionRequest,
  GetItemResponse as GetItemSchema,
  ListItemsResponse as ListItemsSchema,
  ListLogQuery,
  ListProposalsQuery,
  ListProposalsResponse as ListProposalsSchema,
  ListStructuresResponse as ListStructuresSchema,
  SendMessageRequest,
  StartAgentRequest,
  type ErrorBody,
  type GetItemResponse,
  type ItemsErrorCode,
  type ListAgentsResponse,
  type ListHarnessesResponse,
  type ListItemsResponse,
  type ListLogResponse,
  type ListProposalsResponse,
  type ListStructuresResponse,
  type VersionResponse,
} from "@wombat/shared/api";
import { Proposal as ProposalSchema, type Proposal } from "@wombat/shared/items";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

import { AgentError, type AgentErrorCode, type Manager } from "../agents/manager.ts";
import { openAccess, ProposalError, type ProposalErrorCode } from "../items/access.ts";
import type { Catalog, LoadedItem, LoadedStructure } from "../items/catalog.ts";
import type { Writer } from "../items/write.ts";
import type { Harness } from "../harness/harness.ts";
import { logToStderr, type Log } from "../log.ts";
import type { Store } from "../store/store.ts";
import { errorResponse } from "./errors.ts";
import { createAlertStreams } from "./events.ts";
import { mcpRoutes } from "./mcp.ts";
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
  /** The items; without it the items routes answer items_not_configured. */
  items?: Catalog;
  /** Writes the items; with `items`, it opens the agents' write tools on /mcp. */
  writer?: Writer;
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

/** `items_not_writable` is what the write routes answer; no read route does. */
const ITEMS_STATUS: Record<ItemsErrorCode, ContentfulStatusCode> = {
  items_not_configured: 409,
  structure_not_found: 404,
  item_not_found: 404,
  items_not_writable: 500,
  proposal_not_found: 404,
  proposal_not_pending: 409,
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

/** Each item's current handle by id, for the link values. */
const handlesById = (items: LoadedItem[]) =>
  new Map(items.flatMap((item) => (item.id === null ? [] : [[item.id, item.handle] as const])));

/** An item as the API sends it: link values become `{ id, handle }`; the catalog holds the target's raw id. */
const withLinks = (item: LoadedItem, structures: LoadedStructure[], handles: Map<string, string | null>) => {
  const { structure: structureId, ...rest } = item;
  const settings = structures.find((structure) => structure.id === structureId)?.settings;
  if (!settings) return rest;
  const properties = { ...rest.properties };
  for (const [name, property] of Object.entries(settings.properties)) {
    const value = properties[name];
    if (property.type === "link" && typeof value === "string") {
      properties[name] = { id: value, handle: handles.get(value) ?? null };
    }
  }
  return { ...rest, properties };
};

const summarize = (structure: LoadedStructure, items: LoadedItem[]) => {
  const own = items.filter((item) => item.structure === structure.id);
  const listing = {
    path: structure.path,
    itemCount: structure.id === null ? 0 : own.length,
    invalidCount: structure.id === null ? 0 : own.filter((item) => item.problems.length > 0).length,
    problems: structure.problems,
  };
  if (structure.id === null) return { id: null, ...listing };
  const { id, settings } = structure;
  const { name, prefix, access, naming, instructions, properties, views } = settings;
  return { id, name, prefix, access, naming, instructions, properties, views, ...listing };
};

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
  items,
  writer,
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

  const notConfigured = (c: Context) =>
    errorResponse(
      c,
      ITEMS_STATUS.items_not_configured,
      "items_not_configured",
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
        "structure_not_found",
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
    const found =
      all.find((item) => item.handle === handle) ?? all.find((item) => item.aliases.includes(handle));
    if (!found) {
      return errorResponse(
        c,
        ITEMS_STATUS.item_not_found,
        "item_not_found",
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
    if (error instanceof ProposalError) return errorResponse(c, ITEMS_STATUS[error.code satisfies ProposalErrorCode], error.code, error.message);
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
