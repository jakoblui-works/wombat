import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { ContextBreakdown } from "@wombat/shared/api";
import { z } from "zod";

import { agentEnv } from "./env.ts";
import { MCP_SERVER_NAME, type CacheState, type ContextAgent, type Harness } from "./harness.ts";

const PACKAGE = "@agentclientprotocol/claude-agent-acp";

let entry: string | undefined;

const findBinEntry = (): string | undefined => {
  const packageJson = createRequire(import.meta.url).resolve(`${PACKAGE}/package.json`);
  const { bin } = JSON.parse(readFileSync(packageJson, "utf8")) as { bin?: Record<string, unknown> };
  const relative = bin?.["claude-agent-acp"];
  return typeof relative === "string" ? resolve(dirname(packageJson), relative) : undefined;
};

/** The absolute path of the installed claude-agent-acp's `bin` entry, read from its package.json. */
const binEntry = (): string => {
  if (entry !== undefined) return entry;
  let cause: unknown;
  try {
    entry = findBinEntry();
  } catch (error) {
    cause = error;
  }
  if (entry === undefined) {
    throw new Error(
      `Couldn't find ${PACKAGE}'s claude-agent-acp entry; reinstall the app's dependencies with \`pnpm install\`.`,
      { cause },
    );
  }
  return entry;
};

/** Where the user's claude login lives, when they moved it; claude-agent-acp reads it from its environment. */
const declaredEnv = (source: NodeJS.ProcessEnv): Record<string, string> => {
  const configDir = source.CLAUDE_CONFIG_DIR;
  return typeof configDir === "string" ? { CLAUDE_CONFIG_DIR: configDir } : {};
};

export const claudeCode: Harness = {
  id: "claude-code",
  name: "Claude Code",
  loginHint: "Claude Code isn't logged in. Run `claude` in a terminal and log in, then start the agent again.",
  // claude-agent-acp resumes a stored session (`session/resume`) in a new process; model and effort come back at their
  // defaults, which the manager sets again.
  resumable: true,
  spawn: (cwd, source = process.env) => ({
    command: process.execPath,
    args: [binEntry()],
    cwd,
    env: agentEnv(source, declaredEnv(source)),
  }),
  // The item tools run without a permission prompt each time. Access levels decide what a call may do, and
  // proposals still wait for the user; every other tool still asks.
  // emitRawSDKMessages: claude-agent-acp forwards the SDK's assistant messages as SDK_MESSAGE, for the cache state
  // and the /context report; nothing else is asked for.
  sessionMeta: {
    claudeCode: { options: { allowedTools: [`mcp__${MCP_SERVER_NAME}__*`] }, emitRawSDKMessages: [{ type: "assistant" }] },
  },
  // The top-level ACP field, which claude-agent-acp appends to Claude Code's own prompt. Never
  // `_meta.systemPrompt`: a string there replaces Claude Code's whole system prompt.
  sessionParams: (instructions) => ({ systemPrompt: { mode: "append", content: [{ type: "text", text: instructions }] } }),
  extNotification: (method, params, previous) => {
    const message = method === SDK_MESSAGE ? field(params, "message") : undefined;
    if (field(message, "type") !== "assistant" || field(message, "parent_tool_use_id") !== null) return undefined;
    return { cache: cacheStateOf(message, previous ?? null) };
  },
  contextBreakdown: (agent) => claudeContextBreakdown(agent),
  contextCommand: "context",
};

/** The extension notification claude-agent-acp forwards a raw SDK message as: `{ sessionId, message }`. */
const SDK_MESSAGE = "_claude/sdkMessage";
/** What a report this app can't get or read means, and what to do; no retry fixes it. */
const CONTEXT_UNREADABLE =
  "This version of Claude Code (claude-agent-acp) doesn't report its context in a form Wombat reads. Update it, then try again.";
/** How long `contextBreakdown` waits for Claude's /context report. */
const CONTEXT_TIMEOUT_MS = 15_000;

/**
 * Why the Claude harness couldn't make a breakdown: `promptAnswered` says whether Claude had answered `/context`,
 * `timeoutMs` how long it was waited for (default CONTEXT_TIMEOUT_MS).
 */
export type ContextFailure = { promptAnswered: boolean; reason: "timeout" | "unreadable"; fields?: string[]; timeoutMs?: number };

/**
 * The message of every error the Claude harness throws for a breakdown, with the step that fixes it: a `/context`
 * still unanswered at the timeout is a busy agent (the manager cancels the prompt), so try again once it is idle; an
 * answer without a report, or a report this app can't read, is a claude-agent-acp this app doesn't read, so update it.
 */
export const contextFailureMessage = ({ promptAnswered, reason, fields = [], timeoutMs = CONTEXT_TIMEOUT_MS }: ContextFailure): string => {
  if (reason === "timeout" && !promptAnswered) {
    return (
      `The agent didn't answer /context within ${timeoutMs / 1000} s; it was cancelled. ` +
      "Try again once it is idle, or stop the agent if it stays busy."
    );
  }
  if (reason === "timeout") return `${CONTEXT_UNREADABLE} It answered /context without a report.`;
  return `${CONTEXT_UNREADABLE}${fields.length === 0 ? "" : ` Its report lacks or garbles: ${fields.join(", ")}.`}`;
};

/**
 * The Claude harness's `contextBreakdown`, with the report's timeout as a parameter (tests shorten it). `/context`
 * runs as a turn of its own; its report arrives as the SDK_MESSAGE carrying `context_usage`, before the prompt's
 * answer, so the wait starts first. Both are awaited together, so the timeout bounds the call even while the prompt
 * stays open (the manager then cancels it); whichever fails first is the answer.
 */
export const claudeContextBreakdown = async (
  { prompt, nextExt, home }: ContextAgent,
  timeoutMs: number = CONTEXT_TIMEOUT_MS,
): Promise<ContextBreakdown> => {
  let promptAnswered = false;
  const report = nextExt(SDK_MESSAGE, (params) => contextUsage(params) !== undefined, timeoutMs).catch(() => {
    throw new Error(contextFailureMessage({ promptAnswered, reason: "timeout", timeoutMs }));
  });
  const answered = prompt("/context").then((answer) => {
    promptAnswered = true;
    return answer;
  });
  const [params] = await Promise.all([report, answered]);
  return contextBreakdownOf(contextUsage(params), home);
};

/** `value[key]` when `value` is an object, else undefined. */
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

/** The `context_usage` of an SDK_MESSAGE's params, if its message has one. */
const contextUsage = (params: unknown): unknown => field(field(params, "message"), "context_usage");

// Claude's SDKContextUsage (@anthropic-ai/claude-agent-sdk), read leniently: fields this app doesn't know are dropped,
// a missing list is an empty one (`skills` is left out when empty), and a row that doesn't read is dropped alone.
const row = <T extends z.ZodRawShape>(shape: T) => {
  const one = z.looseObject(shape);
  return z
    .array(z.unknown())
    .catch([])
    .transform((rows) =>
      rows.flatMap((value) => {
        const parsed = one.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      }),
    );
};
const ClaudeContextUsage = z.looseObject({
  model: z.string(),
  total_tokens: z.number(),
  raw_max_tokens: z.number(),
  categories: z.array(z.looseObject({ name: z.string(), tokens: z.number(), kind: z.unknown() })),
  memory_files: row({ path: z.string(), type: z.string(), tokens: z.number() }),
  agents: row({ agent_type: z.string(), source: z.string(), tokens: z.number() }),
  skills: row({ name: z.string(), source: z.string(), tokens: z.number() }),
  mcp_tools: row({ name: z.string(), server_name: z.string(), tokens: z.number() }),
});

/** `path` with `home` shown as `~`, when it lies under `home` at a path separator (not `/home/userx` for `/home/user`). */
const tildePath = (path: string, home: string | undefined): string => {
  const root = home?.replace(/\/+$/, "");
  if (root === undefined || root === "") return path;
  if (path === root) return "~";
  return path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path;
};

/**
 * Claude's `context_usage` (SDKContextUsage) as a ContextBreakdown: `used` is `total_tokens`, `size` `raw_max_tokens`,
 * the categories as sent (an unknown kind reads as "used"), then the lists memory_files, custom_agents, skills,
 * mcp_tools, each only when non-empty. The one reader of Claude's shape; throws when a field it needs is missing.
 */
export const contextBreakdownOf = (usage: unknown, home: string | undefined): ContextBreakdown => {
  const parsed = ClaudeContextUsage.safeParse(usage);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "the report"))];
    throw new Error(contextFailureMessage({ promptAnswered: true, reason: "unreadable", fields }));
  }
  const report = parsed.data;
  const lists = [
    { id: "memory_files", title: "Memory files", rows: report.memory_files.map((r) => ({ name: tildePath(r.path, home), detail: r.type, tokens: r.tokens })) },
    { id: "custom_agents", title: "Custom agents", rows: report.agents.map((r) => ({ name: r.agent_type, detail: r.source, tokens: r.tokens })) },
    { id: "skills", title: "Skills", rows: report.skills.map((r) => ({ name: r.name, detail: r.source, tokens: r.tokens })) },
    { id: "mcp_tools", title: "MCP tools", rows: report.mcp_tools.map((r) => ({ name: r.name, detail: r.server_name, tokens: r.tokens })) },
  ].filter((list) => list.rows.length > 0);
  return ContextBreakdown.parse({
    model: report.model,
    used: report.total_tokens,
    size: report.raw_max_tokens,
    categories: report.categories,
    lists,
  });
};

const tokens = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** The message's ISO `timestamp`; the service's clock when it has none (older emitters) or an unreadable one. */
const stampOf = (message: unknown): string => {
  const stamp = field(message, "timestamp");
  return typeof stamp === "string" && z.iso.datetime({ offset: true }).safeParse(stamp).success ? stamp : new Date().toISOString();
};

/**
 * The prompt cache after one raw assistant message (SDKAssistantMessage), from its `message.usage`: a write to the 1h
 * cache makes it 1h, else a write to the 5m cache 5m (a write with no split given counts as 5m, the API's default); a
 * read alone refreshes the known cache at its TTL; neither (the synthetic /context reply) leaves it as it was. No
 * cache known and no write: null. Timed by the message's `timestamp`.
 */
export const cacheStateOf = (message: unknown, previous: CacheState | null): CacheState | null => {
  const usage = field(field(message, "message"), "usage");
  const creation = field(usage, "cache_creation");
  const h1 = tokens(field(creation, "ephemeral_1h_input_tokens"));
  const m5 = tokens(field(creation, "ephemeral_5m_input_tokens"));
  const written = h1 + m5 > 0 || (creation === undefined && tokens(field(usage, "cache_creation_input_tokens")) > 0);
  const read = tokens(field(usage, "cache_read_input_tokens")) > 0;
  if (!written && !read) return previous;
  const ttlSeconds = h1 > 0 ? 3600 : written ? 300 : previous?.ttlSeconds;
  return ttlSeconds === undefined ? null : { ttlSeconds, lastRequestAt: stampOf(message) };
};
