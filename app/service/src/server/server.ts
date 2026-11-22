import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { API_VERSION } from "@wombat/shared";
import { BODY_OVER_CAP_MESSAGE, HEARTBEAT_MS, ServerErrorCode, type AgentSummary, type ErrorBody } from "@wombat/shared/api";
import { errorCode } from "@wombat/shared/errno";
import { MAX_BODY_BYTES, ROUTES, type ResponseOf } from "@wombat/shared/routes";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { requireAgent } from "../agents/errors.ts";
import { AgentError, type Manager } from "../agents/manager.ts";
import type { WorkspaceItems } from "../items/workspace-items.ts";
import type { Harness } from "../harness/harness.ts";
import { harnessFeatures } from "../harness/registry.ts";
import { logToStderr, type Log } from "../log.ts";
import type { ApproveStep } from "../proposals/apply.ts";
import { openProposals } from "../proposals/proposals.ts";
import { ProposalError } from "../proposals/refused.ts";
import type { Store } from "../store/store.ts";
import { listRepos, RepoError, WorkspaceError } from "../workspace.ts";
import { AGENT_CALL_STATUS, AGENT_STATUS, errorResponse, ITEMS_STATUS, SERVER_STATUS, WORKSPACE_STATUS } from "./errors.ts";
import { createAlertStreams } from "./events.ts";
import { itemRoutes } from "./item-routes.ts";
import { mcpRoutes } from "./mcp.ts";
import { portRules } from "./port-rules.ts";
import { proposalRoutes } from "./proposal-routes.ts";
import { InvalidRequest, readBody, readQuery } from "./request.ts";
import { NO_WORKSPACE, workspaceRoutes } from "./workspace-routes.ts";

export type ServerOptions = {
  manager: Manager;
  store: Store;
  harnesses: readonly Harness[];
  /**
   * The one workspace new proposals belong to, and whose items the agents' /mcp tools reach (until they take their
   * agent's). Agents, repos and the items routes take their workspace by id.
   */
  workspace?: { id: string; root: string };
  /**
   * Each workspace's items (workspace-items.ts): the items routes and the proposals ask it, and the workspace routes
   * open a workspace's items before they answer. Without it no workspace has items.
   */
  items?: Pick<WorkspaceItems, "of" | "open" | "reopen">;
  /** The bearer token every request must carry. */
  token: string;
  /** 0 (the default) picks a free port. */
  port?: number;
  heartbeatMs?: number;
  /** The log route's limit when the request sends none. */
  defaultLogLimit?: number;
  /** Ids and names only, like the manager's log. */
  log?: Log;
  /**
   * Called once POST /shutdown has stopped every agent and its response is out: the service's own stop path,
   * which main passes. Without it the route still stops the agents, but the service keeps running.
   */
  onShutdown?: () => void;
  /** Called when POST /shutdown begins, before any agent is stopped; main removes the discovery file there. */
  onShutdownStart?: () => void;
  /** When the service started and which code it runs (codeIdOf its checkout), for `GET /version`; main sets both once. */
  identity?: { startedAt: string; codeId: string };
  /** Called synchronously at each named step of an approve; main passes it through for the crash tests. */
  onApproveStep?: (step: ApproveStep) => void;
};

/** Shorter tokens are guessable by a local process that can try requests in a loop. */
const MIN_TOKEN_LENGTH = 16;
/** How long close() lets ended responses flush before it drops the connections left. */
const CLOSE_GRACE_MS = 1_000;

/** Serves the API on 127.0.0.1 only; resolves once it is listening. */
export const startServer = async ({
  manager,
  store,
  harnesses,
  workspace,
  token,
  port = 0,
  heartbeatMs = HEARTBEAT_MS,
  defaultLogLimit = 1000,
  log = logToStderr,
  items,
  onShutdown,
  onShutdownStart,
  identity,
  onApproveStep,
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
  /** A stored summary with the agent's live cache state, which is never stored; the only place it is added. */
  const withLiveCache = (agent: AgentSummary): AgentSummary => {
    const cache = manager.liveCache(agent.id);
    return cache === undefined ? agent : { ...agent, cache };
  };
  // Proposal changes reach the alert stream through the manager's listeners, like agent changes.
  const onProposal = (id: string, seq: number) => manager.proposalCommitted(id, seq);
  const findAgent = (id: string) => store.listAgents().find((agent) => agent.id === id);
  const { id: workspaceId, root: workspaceRoot } = workspace ?? NO_WORKSPACE;
  const { access, proposals, notes } = openProposals({
    store,
    workspace: workspaceRoot,
    workspaceId,
    agentFolder: (agentId) => manager.agentFolder(requireAgent(agentId, findAgent)),
    onProposal,
    log,
    items: workspace === undefined ? undefined : items?.of(workspace.id),
    onApproveStep,
  });
  // Before the server listens: no request may see a proposal a service death left applying.
  await proposals.settleAtStart();

  // Before the port rules: /mcp takes an agent's token, never the app's, and the port rules refuse agent tokens.
  app.route(
    "/",
    mcpRoutes({
      access,
      proposals,
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

  app.get("/version", (c) => c.json({ apiVersion: API_VERSION, ...identity } satisfies ResponseOf<typeof ROUTES.version>));

  app.get("/harnesses", (c) =>
    c.json(harnesses.map((harness) => ({ id: harness.id, name: harness.name, features: harnessFeatures(harness) })) satisfies ResponseOf<typeof ROUTES.listHarnesses>),
  );

  workspaceRoutes(app, { store, workspacesCommitted: manager.workspacesCommitted, ...(items === undefined ? {} : { items }) });

  app.get("/workspaces/:ws/repos", (c) =>
    c.json({ repos: listRepos(manager.rootOf(c.req.param("ws"))) } satisfies ResponseOf<typeof ROUTES.listRepos>),
  );

  app.get("/agents", (c) =>
    c.json({ dbId: store.dbId, seq: store.currentSeq(), agents: store.listAgents().map(withLiveCache) } satisfies ResponseOf<typeof ROUTES.listAgents>),
  );

  app.post("/agents", async (c) => {
    const { workspace: workspaceId, harness, repo } = await readBody(c, ROUTES.startAgent.body);
    return c.json(await manager.start(workspaceId, harness, repo) satisfies ResponseOf<typeof ROUTES.startAgent>, 201);
  });

  app.get("/agents/:id/log", (c) => {
    const query = readQuery(c, ROUTES.agentLog.query);
    const agentId = c.req.param("id");
    requireAgent(agentId, findAgent);
    const { after, limit = defaultLogLimit } = query;
    const { entries, truncated } = store.readLog(agentId, after, limit);
    return c.json({ dbId: store.dbId, seq: store.currentSeq(), entries, truncated } satisfies ResponseOf<typeof ROUTES.agentLog>);
  });

  app.post("/agents/:id/messages", async (c) => {
    const message = await readBody(c, ROUTES.sendMessage.body);
    return c.json(await manager.send(c.req.param("id"), message) satisfies ResponseOf<typeof ROUTES.sendMessage>, 202);
  });

  app.post("/agents/:id/permissions/:requestId", async (c) => {
    const { kind } = await readBody(c, ROUTES.answerPermission.body);
    manager.answer(c.req.param("id"), c.req.param("requestId"), kind);
    return c.body(null, 204);
  });

  // 204 once the agent's new options are stored: a read of the log right after holds them.
  app.post("/agents/:id/config", async (c) => {
    const { configId, value } = await readBody(c, ROUTES.setConfig.body);
    await manager.setConfig(c.req.param("id"), configId, value);
    return c.body(null, 204);
  });

  // A hidden turn: the breakdown, with nothing of the turn in the agent's log or summary.
  app.post("/agents/:id/context", async (c) => c.json(await manager.contextBreakdown(c.req.param("id")) satisfies ResponseOf<typeof ROUTES.contextBreakdown>));

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
    return c.json({} satisfies ResponseOf<typeof ROUTES.shutdown>, 202);
  });

  manager.setNoteSource(notes);
  itemRoutes(app, { of: (workspaceId) => items?.of(workspaceId), getWorkspace: store.getWorkspace });
  proposalRoutes(app, proposals);

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
    if (error instanceof InvalidRequest) return errorResponse(c, SERVER_STATUS.invalid_request, ServerErrorCode.enum.invalid_request, error.message, undefined, error.problems);
    if (error instanceof ProposalError) return errorResponse(c, ITEMS_STATUS[error.code], error.code, error.message);
    if (error instanceof RepoError) return errorResponse(c, AGENT_STATUS[error.code], error.code, error.message);
    if (error instanceof WorkspaceError) return errorResponse(c, WORKSPACE_STATUS[error.code], error.code, error.message);
    if (error instanceof AgentError) return errorResponse(c, AGENT_CALL_STATUS[error.code], error.code, error.message, error.hint);
    // The details stay in the service: an error's message may quote agent content or paths.
    // An errno code, when there is one, names no path.
    const code = errorCode(error);
    log("request_failed", { method: c.req.method, route: c.req.routePath, error: error.name, ...(code === error.name ? {} : { code }) });
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
