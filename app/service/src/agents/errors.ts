import { AgentErrorCode, type ServerErrorCode } from "@wombat/shared/api";

/** A manager call's error codes: the agent ones, and `invalid_request` for a config value the option doesn't take. */
export type AgentErrorCodes = AgentErrorCode | typeof ServerErrorCode.enum.invalid_request;

/** A failed manager call; the server maps `code` to its HTTP status. */
export class AgentError extends Error {
  readonly code: AgentErrorCodes;
  readonly hint: string | undefined;

  constructor(code: AgentErrorCodes, message: string, hint?: string) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.hint = hint;
  }
}

export const ACP_AUTH_REQUIRED = -32000;

/** A JSON-RPC error's message: the agent's own text, so it goes back to the app and never to a log line. */
export const rpcMessage = (error: unknown) =>
  typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : undefined;

export const rpcCode = (error: unknown) =>
  typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "number"
    ? (error as { code: number }).code
    : undefined;

export const notFound = (agentId: string) =>
  new AgentError(AgentErrorCode.enum.not_found, `There's no agent ${agentId}. List the agents to see which exist.`);

/** What `find` has for the agent; throws `notFound` when it has nothing. */
export const requireAgent = <T>(agentId: string, find: (agentId: string) => T | undefined): T => {
  const found = find(agentId);
  if (found === undefined) throw notFound(agentId);
  return found;
};

export const busy = (message: string) => new AgentError(AgentErrorCode.enum.busy, message);

/** Why a call found no process to act on; `resumable` (its harness's) says whether a message starts it again. */
export const notRunning = (resumable = false) =>
  new AgentError(
    AgentErrorCode.enum.not_running,
    `The agent isn't running (it was stopped or its process ended). ${
      resumable ? "Send a message to start it again" : "Start a new agent to continue"
    }; its history is kept.`,
  );

/** Why an agent without a process stays so: its harness can't resume it, so its chat is closed. */
export const notResumable = () =>
  new AgentError(AgentErrorCode.enum.not_running, "This agent can't be started again. Start a new agent to continue.");
