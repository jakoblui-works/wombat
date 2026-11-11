// `/mcp`: the item tools for agents, over MCP's streamable HTTP (stateless, JSON answers). Only an agent's own token
// opens it, and every call goes through Access as that agent, so access levels, locks and hidden structures hold
// exactly as Access decides them. Answers and refusals are tool results; nothing here names a structure id, so the
// tool list carries nothing of a hidden one.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { API_VERSION } from "@wombat/shared";
import { ServerErrorCode } from "@wombat/shared/api";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { AccessError, SEARCH_LIMIT, type Access, type ItemInput } from "../items/access.ts";
import { TOOL } from "../items/tools.ts";
import type { Log } from "../log.ts";
import { errorResponse } from "./errors.ts";
import { refuseForeignHost } from "./port-rules.ts";

type McpEnv = { Variables: { agentId: string } };

export type McpOptions = {
  /** Without it (no items configured) every tool answers that the items aren't set up. */
  access: Access | undefined;
  /** The agent a bearer token belongs to, while it runs: the manager's live token map. */
  agentForToken: (token: string) => string | undefined;
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
    const agentId = token === undefined ? undefined : agentForToken(token);
    if (agentId === undefined) {
      return errorResponse(
        c,
        401,
        ServerErrorCode.enum.unauthorized,
        "The request has no valid agent token. /mcp is for the agents the Wombat service started; call it with the " +
          "`Authorization` header from the agent's MCP configuration, while the agent runs.",
      );
    }
    if (c.req.header("origin") !== undefined) {
      return errorResponse(
        c,
        403,
        ServerErrorCode.enum.forbidden_origin,
        "Requests with an Origin header are refused on /mcp. Call it from the agent, without an Origin header.",
      );
    }
    const foreignHost = refuseForeignHost(c, port());
    if (foreignHost) return foreignHost;
    c.set("agentId", agentId);
    await next();
  };

// Input schemas. None lists structure ids: that would name hidden structures, and go stale when one is added.
const structure = z.string().describe(`A structure's id, as ${TOOL.describeStructure} lists it.`);
const handle = z.string().describe("An item's handle, like BUG-14 (an old handle, an alias, works too).");
const version = z
  .string()
  .describe(`The item's version from your last ${TOOL.getItem}. If the item changed since, re-read it and try again.`);
const reason = z.string().describe("Why you propose this, for the user who approves or rejects it.");
const fields = z
  .record(z.string(), z.unknown())
  .describe(
    "Only the fields to change: `title`, `body` or property names, each with its new value (link values are handles).",
  );
const createShape = {
  structure,
  title: z.string().describe("The item's title."),
  body: z.string().optional().describe("Markdown after the title line."),
  properties: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(`Property name → value, as ${TOOL.describeStructure} lists them (link values are handles).`),
  file: z
    .string()
    .optional()
    .describe("Only for a structure with free naming: the new file's path, relative to the structure's folder."),
};

/** ItemInput as the input schema gives it: an optional field the agent left out is undefined. */
type CreateArgs = Pick<ItemInput, "title"> & { [K in Exclude<keyof ItemInput, "title">]?: ItemInput[K] | undefined };

/** A create's item fields, without the ones the agent left out. */
const itemInput = ({ title, body, properties, file }: CreateArgs): ItemInput => ({
  title,
  ...(body === undefined ? {} : { body }),
  ...(properties === undefined ? {} : { properties }),
  ...(file === undefined ? {} : { file }),
});

const text = (value: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError: true } : {}),
});

/** One McpServer for one request, every tool bound to the calling agent. */
const toolServer = ({ access, log }: Pick<McpOptions, "access" | "log">, agentId: string) => {
  const server = new McpServer({ name: "wombat", version: String(API_VERSION) }, { capabilities: { tools: {} } });

  /** Runs one tool through Access: its answer as JSON in one text block, a refusal as an error with its message. */
  const run =
    <A>(tool: string, call: (access: Access, args: A) => Promise<unknown>) =>
    async (args: A): Promise<CallToolResult> => {
      if (access === undefined) {
        return text(
          "The Wombat service has no items set up, so there are none to read or change. Ask the user to set WOMBAT_ITEMS and restart the service.",
          true,
        );
      }
      try {
        return text(JSON.stringify(await call(access, args)));
      } catch (error) {
        if (error instanceof AccessError) return text(error.message, true);
        // The details stay in the service: an unexpected error's message may name files or hidden items.
        log("tool_failed", { agentId, tool, error: error instanceof Error ? error.name : "unknown" });
        return text(`The Wombat service failed to run ${tool}. Try again; if it keeps failing, tell the user.`, true);
      }
    };

  server.registerTool(
    TOOL.describeStructure,
    {
      description:
        "Describes a structure you can use: its name, access level (read, propose or edit), properties and locked " +
        "fields. Without `structure`, describes every structure you can use.",
      inputSchema: z.object({ structure: structure.optional() }),
    },
    run(TOOL.describeStructure, (a, { structure: id }: { structure?: string | undefined }) =>
      id === undefined ? a.structures() : a.describe(id),
    ),
  );
  server.registerTool(
    TOOL.listItems,
    {
      description: "Lists a structure's items: handle, title, properties and problems (no body).",
      inputSchema: z.object({ structure }),
    },
    run(TOOL.listItems, (a, { structure: id }: { structure: string }) => a.list(id)),
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
        "Finds items whose title, body or text properties contain `query` (any case), in one structure or all you " +
        `can use. Answers at most ${SEARCH_LIMIT}; \`truncated\` says there were more.`,
      inputSchema: z.object({ query: z.string().describe("The text to look for."), structure: structure.optional() }),
    },
    run(TOOL.search, (a, { query, structure: id }: { query: string; structure?: string | undefined }) => a.search(query, id)),
  );
  server.registerTool(
    TOOL.createItem,
    {
      description: "Creates an item in a structure open to edits. Answers its handle and version.",
      inputSchema: z.object(createShape),
    },
    run(TOOL.createItem, (a, { structure: id, ...input }: CreateArgs & { structure: string }) =>
      a.create(agentId, id, itemInput(input)),
    ),
  );
  server.registerTool(
    TOOL.updateItem,
    {
      description: "Changes some fields of an item in a structure open to edits. Answers its handle and new version.",
      inputSchema: z.object({ handle, fields, version }),
    },
    run(TOOL.updateItem, (a, args: { handle: string; fields: Record<string, unknown>; version: string }) =>
      a.update(agentId, args.handle, args.fields, args.version),
    ),
  );
  server.registerTool(
    TOOL.deleteItem,
    {
      description: "Deletes an item in a structure open to edits.",
      inputSchema: z.object({ handle, version }),
    },
    run(TOOL.deleteItem, (a, args: { handle: string; version: string }) => a.remove(agentId, args.handle, args.version)),
  );
  server.registerTool(
    TOOL.proposeCreate,
    {
      description:
        "Proposes a new item in a structure open to proposals; the user approves or rejects it. Answers the proposal's id.",
      inputSchema: z.object({ ...createShape, reason }),
    },
    run(
      TOOL.proposeCreate,
      (a, { structure: id, reason: why, ...input }: CreateArgs & { structure: string; reason: string }) =>
        a.proposeCreate(agentId, id, itemInput(input), why),
    ),
  );
  server.registerTool(
    TOOL.proposeUpdate,
    {
      description:
        "Proposes changing some fields of an item in a structure open to proposals; the user approves or rejects it. " +
        "Answers the proposal's id.",
      inputSchema: z.object({ handle, fields, version, reason }),
    },
    run(
      TOOL.proposeUpdate,
      (a, args: { handle: string; fields: Record<string, unknown>; version: string; reason: string }) =>
        a.proposeUpdate(agentId, args.handle, args.fields, args.version, args.reason),
    ),
  );
  server.registerTool(
    TOOL.proposeDelete,
    {
      description:
        "Proposes deleting an item in a structure open to proposals; the user approves or rejects it. Answers the proposal's id.",
      inputSchema: z.object({ handle, version, reason }),
    },
    run(TOOL.proposeDelete, (a, args: { handle: string; version: string; reason: string }) =>
      a.proposeDelete(agentId, args.handle, args.version, args.reason),
    ),
  );
  return server;
};

/** The /mcp routes, to be mounted before the app's port rules: POST only, behind the agent-token rules. */
export const mcpRoutes = (options: McpOptions) => {
  const app = new Hono<McpEnv>();
  app.use("/mcp", mcpRules(options));
  app.post("/mcp", async (c) => {
    const server = toolServer(options, c.get("agentId"));
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
    return errorResponse(c, 405, ServerErrorCode.enum.method_not_allowed, "/mcp only answers POST. Send each JSON-RPC request with POST.");
  });
  return app;
};
