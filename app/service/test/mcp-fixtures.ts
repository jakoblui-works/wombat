// Shared setup for the /mcp tests: a server on an items root, an agent's real token read through the fake agent's
// mcp-config scenario (written to a file, never into the agent's log), and plain JSON-RPC over HTTP to /mcp, so
// tests see exactly what goes over the wire.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, onTestFinished } from "vitest";

import { ACCESS_FILES } from "./access-fixtures.ts";
import { writeRoot } from "./items-fixtures.ts";
import { REPO } from "./manager-fixtures.ts";
import { rawRequest, serve, type Response, type Served } from "./server-fixtures.ts";

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

/** A server with the items, tools and proposals on a fresh copy of `files` (the access fixture by default). */
export const serveItems = async (files: Record<string, string> = ACCESS_FILES) => {
  const root = writeRoot(files);
  const s = await serve({ itemsRoot: root });
  return { s, root };
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

/** One JSON-RPC request to /mcp with `token` as the bearer token (none when undefined), and no Origin. */
export const mcpRequest = (s: Served, token: string | undefined, method: string, params: unknown = {}, options: McpRequestOptions = {}): Promise<Response> => {
  rpcId += 1;
  return rawRequest(s.port, {
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
export const callTool = async (s: Served, token: string, name: string, args: Record<string, unknown>): Promise<ToolAnswer> => {
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
