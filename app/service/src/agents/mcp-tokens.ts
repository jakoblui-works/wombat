import { createHash, randomBytes } from "node:crypto";

import type { McpServer } from "@agentclientprotocol/sdk";

import { MCP_SERVER_NAME } from "../harness/harness.ts";
import { mayMintToken } from "./phase.ts";
import type { Proc } from "./proc.ts";

/** The token map's key: a hash, so a lookup's timing says nothing about the token itself. */
const tokenKey = (token: string) => createHash("sha256").update(token).digest("base64url");

export type McpTokensDeps = {
  /** Whether `proc` is its agent's live process: a token is minted only for that one. */
  isCurrent: (proc: Proc) => boolean;
  shuttingDown: () => boolean;
};

/** The agents' /mcp bearer tokens, one per live process. */
export const createMcpTokens = ({ isCurrent, shuttingDown }: McpTokensDeps) => {
  // Token key → agentId for every agent with a live /mcp token. The tokens themselves are held nowhere: each one
  // only passes through its agent's session/new.
  const agentTokens = new Map<string, string>();
  // Each process's key in `agentTokens`, once minted; dropped when the token is revoked.
  const tokenKeys = new WeakMap<Proc, string>();
  let mcpUrl: string | undefined;

  /**
   * Mints the agent's /mcp token (32 random bytes) and its `mcpServers` entry; none before the server told the
   * manager its URL, or once the process has ended.
   */
  const mcpServersFor = (proc: Proc): McpServer[] => {
    if (mcpUrl === undefined || shuttingDown() || !isCurrent(proc) || !mayMintToken(proc.phase)) return [];
    const token = randomBytes(32).toString("base64url");
    const key = tokenKey(token);
    tokenKeys.set(proc, key);
    agentTokens.set(key, proc.agentId);
    return [{ type: "http", name: MCP_SERVER_NAME, url: mcpUrl, headers: [{ name: "Authorization", value: `Bearer ${token}` }] }];
  };

  const revokeToken = (proc: Proc) => {
    const key = tokenKeys.get(proc);
    if (key === undefined) return;
    agentTokens.delete(key);
    tokenKeys.delete(proc);
  };

  /** Where agents reach the service's /mcp endpoint; agents started from now on get a token and this URL. */
  const setMcpUrl = (url: string) => {
    mcpUrl = url;
  };

  /** The agent a /mcp bearer token belongs to, while that agent's process runs; undefined for any other string. */
  const agentForToken = (token: string): string | undefined => agentTokens.get(tokenKey(token));

  return { mcpServersFor, revokeToken, setMcpUrl, agentForToken };
};

export type McpTokens = ReturnType<typeof createMcpTokens>;
