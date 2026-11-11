// Shared setup for the /mcp tests: the /mcp routes in process on the real access module with a stub agent token, for
// what the endpoint does with a call; a server on an items root, with an agent's real token read through the fake
// agent's mcp-config scenario (written to a file, never into the agent's log), for what a running agent is given;
// and plain JSON-RPC over HTTP to /mcp, so tests see exactly what goes over the wire.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, onTestFinished } from "vitest";

import type { Access } from "../src/items/access.ts";
import type { LogFields } from "../src/log.ts";
import { mcpRoutes } from "../src/server/mcp.ts";
import { ACCESS_FILES, openAccessRoot, type AccessSetup } from "./access-fixtures.ts";
import { writeRoot } from "./items-fixtures.ts";
import { REPO } from "./manager-fixtures.ts";
import { serve, type RequestOptions, type Response, type Served } from "./server-fixtures.ts";

export type McpServerEntry = { type?: string; name?: string; url?: string; headers?: { name: string; value: string }[] };

export type AgentConfig = {
  agentId: string;
  /** The `mcpServers` entries the agent got at session/new. */
  mcpServers: McpServerEntry[];
  /** The agent process's environment. */
  env: Record<string, string>;
  /** The bearer token from the wombat entry's Authorization header (the fixture fails the test without one). */
  token: string;
};

/** The token the stub agents below carry; no running agent has it. */
export const STUB_TOKEN = "stub-agent-token-for-the-mcp-tests";
export const STUB_AGENT = "agent-mcp-stub";

export type McpApp = AccessSetup & {
  /** Where the routes believe they listen; the default Host header names it. */
  port: number;
  token: string;
  agentId: string;
  /** What the routes logged, in order. */
  logs: { event: string; fields: LogFields }[];
  /** A raw request as `RequestOptions` describes it. */
  request: (options: RequestOptions) => Promise<Response>;
};

/**
 * The /mcp routes in process, on the real access module over a fresh copy of `files` (the access fixture by
 * default), with STUB_TOKEN as the one live agent token. `access` replaces the real access module, for failures.
 */
export const openMcp = ({ files = ACCESS_FILES, access }: { files?: Record<string, string>; access?: Access } = {}): McpApp => {
  const opened = openAccessRoot(files);
  const port = 4123;
  const logs: McpApp["logs"] = [];
  const app = mcpRoutes({
    access: access ?? opened.access,
    agentForToken: (sent) => (sent === STUB_TOKEN ? STUB_AGENT : undefined),
    port: () => port,
    // The service's limit; the limit itself is tested on the running server.
    maxBodyBytes: 1024 * 1024,
    log: (event, fields) => logs.push({ event, fields }),
  });
  const request = async ({ method = "GET", path, headers = {}, body, host = `127.0.0.1:${port}` }: RequestOptions): Promise<Response> => {
    const json = body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body);
    const data = json ? Buffer.from(JSON.stringify(body)) : typeof body === "string" ? Buffer.from(body) : body;
    const response = await app.request(path, {
      method,
      headers: {
        ...(host === null ? {} : { host }),
        ...(json ? { "content-type": "application/json" } : {}),
        // As a client on the wire sends it.
        ...(data === undefined ? {} : { "content-length": String(data.length) }),
        ...headers,
      },
      ...(data === undefined ? {} : { body: data }),
    });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text === "" ? undefined : JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    return { status: response.status, headers: Object.fromEntries(response.headers), text, json: parsed };
  };
  return { ...opened, port, token: STUB_TOKEN, agentId: STUB_AGENT, logs, request };
};

/** A server with the items, tools and proposals on a fresh copy of `files` (the access fixture by default). */
export const serveItems = async (files: Record<string, string> = ACCESS_FILES) => {
  const root = writeRoot(files);
  const s = await serve({ itemsRoot: root });
  return { s, root };
};

/** serveItems, with STUB_TOKEN taken on /mcp as STUB_AGENT's: for tests of the routes, not of agents' tokens. */
export const serveItemsForStub = async (files: Record<string, string> = ACCESS_FILES) => {
  const root = writeRoot(files);
  const s = await serve({ itemsRoot: root, agentTokens: { [STUB_TOKEN]: STUB_AGENT } });
  return { s, root, token: STUB_TOKEN };
};

/** Starts an mcp-config agent and returns what it was given; `agentId` reuses an agent started before. */
export const agentConfig = async (s: Served, agentId?: string): Promise<AgentConfig> => {
  const id = agentId ?? (await s.manager.start("fake-mcp-config", REPO)).id;
  const dir = mkdtempSync(join(tmpdir(), "wombat-mcp-config-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "config.json");
  const turns = s.entries(id).filter((entry) => entry.type === "turn_ended").length;
  await s.manager.send(id, { text: file });
  await s.turnEnded(id, turns + 1);
  const reported = JSON.parse(readFileSync(file, "utf8")) as { mcpServers?: McpServerEntry[]; env?: Record<string, string> };
  const mcpServers = reported.mcpServers ?? [];
  const wombat = mcpServers.find((entry) => entry.name === "wombat");
  const header = wombat?.headers?.find((candidate) => candidate.name.toLowerCase() === "authorization")?.value ?? "";
  expect(header, `the agent's wombat mcpServers entry carries a bearer token: ${JSON.stringify(mcpServers)}`).toMatch(/^Bearer \S+$/);
  return { agentId: id, mcpServers, env: reported.env ?? {}, token: header.replace(/^Bearer /, "") };
};

let rpcId = 0;

export type McpRequestOptions = { headers?: Record<string, string>; host?: string | null };

/** Where a test sends /mcp requests: a running server, or the routes in process. */
export type McpTarget = Pick<Served | McpApp, "request">;

/** One JSON-RPC request to /mcp with `token` as the bearer token (none when undefined), and no Origin. */
export const mcpRequest = (s: McpTarget, token: string | undefined, method: string, params: unknown = {}, options: McpRequestOptions = {}): Promise<Response> => {
  rpcId += 1;
  return s.request({
    method: "POST",
    path: "/mcp",
    headers: {
      accept: "application/json, text/event-stream",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...options.headers,
    },
    body: { jsonrpc: "2.0", id: rpcId, method, params },
    ...(options.host === undefined ? {} : { host: options.host }),
  });
};

export type ToolAnswer = { isError: boolean; text: string; json: unknown };

/** Calls a tool and returns its answer: the text block and, when it is JSON, its value. Fails on an HTTP error. */
export const callTool = async (s: McpTarget, token: string, name: string, args: Record<string, unknown>): Promise<ToolAnswer> => {
  const response = await mcpRequest(s, token, "tools/call", { name, arguments: args });
  expect(response.status, `${name}: ${response.text}`).toBe(200);
  const result = (response.json as { result?: { isError?: boolean; content?: { type: string; text?: string }[] } } | undefined)?.result;
  expect(result, `${name}: a tool result, not a JSON-RPC error: ${response.text}`).toBeDefined();
  const text = result?.content?.find((block) => block.type === "text")?.text ?? "";
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { isError: result?.isError === true, text, json };
};

/** True when a response is a refusal before any tool ran: an HTTP error, with no JSON-RPC result. */
export const isRefused = (response: Response) =>
  response.status >= 400 && (response.json as { result?: unknown } | undefined)?.result === undefined;
