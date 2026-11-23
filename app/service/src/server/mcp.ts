// `/mcp`: the tools for agents, over MCP's streamable HTTP (stateless, JSON answers). Only an agent's own token
// opens it, and the agent's workspace decides whose items its tools reach. Every item call is checked by that
// workspace's Access as that agent, so access levels, locks and hidden binders hold exactly as Access decides them;
// every propose tool stores through the proposals, under one cap. Answers and refusals are tool results; nothing here names a binder id, so the tool list carries nothing of a hidden one.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { API_VERSION } from "@wombat/shared";
import { ServerErrorCode } from "@wombat/shared/api";
import { MAX_EDITS, ProposalReason } from "@wombat/shared/proposals";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { SEARCH_LIMIT, type Access } from "../items/access.ts";
import { SETTINGS_FILE } from "../items/binders.ts";
import { AccessError, type ItemInput } from "../items/refusals.ts";
import { TOOL } from "../items/tools.ts";
import { errorName, type Log } from "../log.ts";
import type { Proposals } from "../proposals/proposals.ts";
import { itemsNotConfiguredForAgent, ProposalRefused } from "../proposals/refused.ts";
import { REBUILT, type RevisedResult } from "../proposals/revise.ts";
import { errorResponse, SERVER_STATUS } from "./errors.ts";
import { refuseForeignHost } from "./port-rules.ts";

/** The agent a live token belongs to, and the workspace whose items its tools reach. */
export type McpAgent = { id: string; workspace: string };

type McpEnv = { Variables: { agent: McpAgent } };

export type McpOptions = {
  /** A workspace's item access, asked on every call; undefined (no items folder) makes every item tool say so. */
  accessOf: (workspaceId: string) => Access | undefined;
  /** A workspace's folder, which names it in the answer of a workspace without items. */
  folderOf: (workspaceId: string) => string;
  /** Works with or without items. */
  proposals: Pick<Proposals, "proposeFile" | "proposeItem" | "revise">;
  /** The agent a bearer token belongs to, while it runs. */
  agentForToken: (token: string) => McpAgent | undefined;
  port: () => number;
  maxBodyBytes: number;
  log: Log;
};

const BEARER = /^Bearer (\S+)$/;

/**
 * Refuses, before any tool runs, a request without a live agent token (the app's token is not one), any request
 * with an Origin (agents send none; a web page always does), and one with a foreign Host.
 */
const mcpRules =
  ({ agentForToken, port }: Pick<McpOptions, "agentForToken" | "port">): MiddlewareHandler<McpEnv> =>
  async (c, next) => {
    const token = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
    const agent = token === undefined ? undefined : agentForToken(token);
    if (agent === undefined) {
      return errorResponse(
        c,
        SERVER_STATUS.unauthorized,
        ServerErrorCode.enum.unauthorized,
        "The request has no valid agent token. /mcp is for the agents the Wombat service started; call it with the " +
          "`Authorization` header from the agent's MCP configuration, while the agent runs.",
      );
    }
    if (c.req.header("origin") !== undefined) {
      return errorResponse(
        c,
        SERVER_STATUS.forbidden_origin,
        ServerErrorCode.enum.forbidden_origin,
        "Requests with an Origin header are refused on /mcp. Call it from the agent, without an Origin header.",
      );
    }
    const foreignHost = refuseForeignHost(c, port());
    if (foreignHost) return foreignHost;
    c.set("agent", agent);
    await next();
  };

// Input schemas. None lists binder ids: that would name hidden binders, and go stale when one is added.
const binder = z.string().describe(`A binder's id, as ${TOOL.describeBinder} lists it.`);
const handle = z.string().describe("An item's handle, like BUG-14 (an old handle, an alias, works too).");
const version = z
  .string()
  .describe(`The item's version from your last ${TOOL.getItem}. If the item changed since, re-read it and try again.`);
const reason = ProposalReason.describe("Why you propose this, for the user who approves or rejects it.");
const fields = z
  .record(z.string(), z.unknown())
  .describe(
    "Only the fields to change: `title`, `body` or property names, each with its new value (link values are handles).",
  );
const createShape = {
  binder,
  title: z.string().describe("The item's title."),
  body: z.string().optional().describe("Markdown after the title line."),
  properties: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(`Property name → value, as ${TOOL.describeBinder} lists them (link values are handles).`),
  file: z
    .string()
    .optional()
    .describe("Only for a binder with free naming: the new file's path, relative to the binder's folder."),
};

/** Replacements, each `old` occurring exactly once in `where` as the edits before it leave it. */
const editList = (where: string) =>
  z
    .array(
      z.object({
        old: z.string().describe(`Text that occurs exactly once in ${where} as the edits before this one leave it.`),
        new: z.string().describe("The text that replaces it, taken literally."),
      }),
    )
    .max(MAX_EDITS, { error: `send at most ${String(MAX_EDITS)} edits in one call; combine neighbouring ones` });

const proposeChangeShape = {
  path: z.string().describe("The file's path: absolute, or relative to the folder you work in."),
  reason,
  edits: editList("the file").optional().describe("For an existing file: the replacements, applied in order. Leave out `content`."),
  content: z.string().optional().describe("For a new file: its whole text. Leave out `edits`."),
};

type EditArgs = { old: string; new: string }[] | undefined;

type ProposeChangeArgs = { path: string; reason: string; edits?: EditArgs; content?: string | undefined };

const reviseShape = {
  id: z.string().describe("The id your propose call answered."),
  reason: ProposalReason.describe("Why this version, for the user: what changed and why."),
  edits: editList("the text the proposal holds now (on a conflict: the file as it is now)")
    .optional()
    .describe("For a file proposal: the replacements, applied in order. Leave out `content` and `fields`."),
  content: z.string().optional().describe("For a file proposal: the whole new text. Leave out `edits` and `fields`."),
  fields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("For an item proposal: the fields it should set instead of the ones it sets now (link values are handles)."),
};

type ReviseArgs = { id: string; reason: string; edits?: EditArgs; content?: string | undefined; fields?: Record<string, unknown> | undefined };

/** The edits as the proposals store them. */
const fileEdits = (edits: EditArgs) => edits?.map((edit) => ({ oldText: edit.old, newText: edit.new }));

/** ItemInput as the input schema gives it: an optional field the agent left out is undefined. */
type CreateArgs = Pick<ItemInput, "title"> & { [K in Exclude<keyof ItemInput, "title">]?: ItemInput[K] | undefined };

/** A create's item fields, without the ones the agent left out. */
const itemInput = ({ title, body, properties, file }: CreateArgs): ItemInput => ({
  title,
  ...(body === undefined ? {} : { body }),
  ...(properties === undefined ? {} : { properties }),
  ...(file === undefined ? {} : { file }),
});

const text = (value: string, isError = false, aside?: string): CallToolResult => ({
  content: [{ type: "text", text: value }, ...(aside === undefined ? [] : [{ type: "text" as const, text: aside }])],
  ...(isError ? { isError: true } : {}),
});

/** The tools whose refusals leave a trace in the service's log: the agent id and the tool, nothing of the call. */
const REFUSALS_LOGGED: ReadonlySet<string> = new Set([TOOL.proposeChange, TOOL.reviseProposal]);

/** One McpServer for one request, every tool bound to the calling agent and its workspace's items as they are now. */
const toolServer = ({ accessOf, folderOf, proposals, log }: Pick<McpOptions, "accessOf" | "folderOf" | "proposals" | "log">, agent: McpAgent) => {
  const agentId = agent.id;
  const access = accessOf(agent.workspace);
  const server = new McpServer({ name: "wombat", version: String(API_VERSION) }, { capabilities: { tools: {} } });

  /** Runs one tool: its answer as JSON in one text block (then `asideOf` its answer, if any, in a second), a refusal as an error with its message. */
  const answer =
    <A, R>(tool: string, call: (args: A) => Promise<R>, asideOf?: (result: R) => string | undefined) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        const result = await call(args);
        return text(JSON.stringify(result), false, asideOf?.(result));
      } catch (error) {
        if (error instanceof AccessError || error instanceof ProposalRefused) {
          if (REFUSALS_LOGGED.has(tool)) log("tool_refused", { agentId, tool });
          return text(error.message, true);
        }
        // The details stay in the service: an unexpected error's message may name files or hidden items.
        log("tool_failed", { agentId, tool, error: errorName(error) });
        return text(`The Wombat service failed to run ${tool}. Try again; if it keeps failing, tell the user.`, true);
      }
    };

  /** Runs one item tool through Access, or answers that there are no items. */
  const run =
    <A>(tool: string, call: (access: Access, args: A) => Promise<unknown>) =>
    async (args: A): Promise<CallToolResult> => {
      if (access === undefined) return text(itemsNotConfiguredForAgent(folderOf(agent.workspace)), true);
      return answer(tool, (a: A) => call(access, a))(args);
    };

  server.registerTool(
    TOOL.describeBinder,
    {
      description:
        `Describes a binder you can use (a folder of items with a \`${SETTINGS_FILE}\` settings file): its name, ` +
        "access level (read, propose or edit), properties and locked fields. Without `binder`, describes every binder you can use.",
      inputSchema: z.object({ binder: binder.optional() }),
    },
    run(TOOL.describeBinder, (a, { binder: id }: { binder?: string | undefined }) =>
      id === undefined ? a.binders() : a.describe(id),
    ),
  );
  server.registerTool(
    TOOL.listItems,
    {
      description: "Lists a binder's items: handle, title, properties and problems (no body).",
      inputSchema: z.object({ binder }),
    },
    run(TOOL.listItems, (a, { binder: id }: { binder: string }) => a.list(id)),
  );
  server.registerTool(
    TOOL.getItem,
    {
      description:
        "Reads one item: handle, aliases, title, body, properties, problems and version. Send the version back " +
        "with any change you make to it.",
      inputSchema: z.object({ handle }),
    },
    run(TOOL.getItem, (a, args: { handle: string }) => a.get(args.handle)),
  );
  server.registerTool(
    TOOL.search,
    {
      description:
        "Finds items whose title, body or text properties contain `query` (any case), in one binder or all you " +
        `can use. Answers at most ${SEARCH_LIMIT}; \`truncated\` says there were more.`,
      inputSchema: z.object({ query: z.string().describe("The text to look for."), binder: binder.optional() }),
    },
    run(TOOL.search, (a, { query, binder: id }: { query: string; binder?: string | undefined }) => a.search(query, id)),
  );
  server.registerTool(
    TOOL.createItem,
    {
      description: "Creates an item in a binder open to edits. Answers its handle and version.",
      inputSchema: z.object(createShape),
    },
    run(TOOL.createItem, (a, { binder: id, ...input }: CreateArgs & { binder: string }) =>
      a.create(agentId, id, itemInput(input)),
    ),
  );
  server.registerTool(
    TOOL.updateItem,
    {
      description: "Changes some fields of an item in a binder open to edits. Answers its handle and new version.",
      inputSchema: z.object({ handle, fields, version }),
    },
    run(TOOL.updateItem, (a, args: { handle: string; fields: Record<string, unknown>; version: string }) =>
      a.update(agentId, args.handle, args.fields, args.version),
    ),
  );
  server.registerTool(
    TOOL.deleteItem,
    {
      description: "Deletes an item in a binder open to edits.",
      inputSchema: z.object({ handle, version }),
    },
    run(TOOL.deleteItem, (a, args: { handle: string; version: string }) => a.remove(agentId, args.handle, args.version)),
  );
  server.registerTool(
    TOOL.proposeCreate,
    {
      description:
        "Proposes a new item in a binder open to proposals; the user approves or rejects it. Answers the proposal's id.",
      inputSchema: z.object({ ...createShape, reason }),
    },
    run(TOOL.proposeCreate, (_a, { binder: id, reason: why, ...input }: CreateArgs & { binder: string; reason: string }) =>
      proposals.proposeItem(agentId, { kind: "create", binder: id, input: itemInput(input) }, why),
    ),
  );
  server.registerTool(
    TOOL.proposeUpdate,
    {
      description:
        "Proposes changing some fields of an item in a binder open to proposals; the user approves or rejects it. " +
        "Answers the proposal's id.",
      inputSchema: z.object({ handle, fields, version, reason }),
    },
    run(TOOL.proposeUpdate, (_a, args: { handle: string; fields: Record<string, unknown>; version: string; reason: string }) =>
      proposals.proposeItem(agentId, { kind: "update", handle: args.handle, fields: args.fields, version: args.version }, args.reason),
    ),
  );
  server.registerTool(
    TOOL.proposeDelete,
    {
      description:
        "Proposes deleting an item in a binder open to proposals; the user approves or rejects it. Answers the proposal's id.",
      inputSchema: z.object({ handle, version, reason }),
    },
    run(TOOL.proposeDelete, (_a, args: { handle: string; version: string; reason: string }) =>
      proposals.proposeItem(agentId, { kind: "delete", handle: args.handle, version: args.version }, args.reason),
    ),
  );
  server.registerTool(
    TOOL.proposeChange,
    {
      description:
        "Proposes a change to a text file, anywhere, instead of making it: for changes the user should approve first, " +
        "such as docs, instructions (CLAUDE.md), skills, and anything you were told to propose. The file stays as it is " +
        "until the user approves. Send `edits` to change an existing file, or `content` for a new one. It only " +
        "suggests: keep working without waiting for the decision. Answers the proposal's id.",
      inputSchema: z.object(proposeChangeShape),
    },
    answer(TOOL.proposeChange, ({ path, reason: why, edits, content }: ProposeChangeArgs) =>
      proposals.proposeFile(agentId, path, why, { edits: fileEdits(edits), content }),
    ),
  );
  server.registerTool(
    TOOL.reviseProposal,
    {
      description:
        "Revises one of your own proposals that the user hasn't decided yet (pending, or a conflict) in place, instead " +
        "of proposing anew: for a file, send `edits` to the text the proposal holds now, or the whole new `content`; " +
        "on a conflict, edits apply to the file as it is now. For an item, send the `fields` it should set. The user " +
        "sees it as a new version of the same proposal. Answers the proposal's id and the new version's number; " +
        "`rebuilt` when, on a conflict, the version was rebuilt on the file or item as it is now and so holds only this " +
        "revision's changes, none of your earlier versions'.",
      inputSchema: z.object(reviseShape),
    },
    answer(
      TOOL.reviseProposal,
      ({ id, reason: why, edits, content, fields: given }: ReviseArgs) => proposals.revise(agentId, id, why, { edits: fileEdits(edits), content, fields: given }),
      (result: RevisedResult) => (result.rebuilt === true ? REBUILT : undefined),
    ),
  );
  return server;
};

/** The /mcp routes, to be mounted before the app's port rules: POST only, behind the agent-token rules. */
export const mcpRoutes = (options: McpOptions) => {
  const app = new Hono<McpEnv>();
  app.use("/mcp", mcpRules(options));
  app.post("/mcp", async (c) => {
    const server = toolServer(options, c.get("agent"));
    // No sessionIdGenerator: stateless, so no session and no `initialize` needed first.
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: options.maxBodyBytes,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  });
  // Stateless: there is no stream to open (GET) and no session to end (DELETE).
  app.all("/mcp", (c) => {
    c.header("allow", "POST");
    return errorResponse(c, SERVER_STATUS.method_not_allowed, ServerErrorCode.enum.method_not_allowed, "/mcp only answers POST. Send each JSON-RPC request with POST.");
  });
  return app;
};
