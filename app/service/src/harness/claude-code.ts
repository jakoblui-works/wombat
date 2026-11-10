import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { agentEnv } from "./env.ts";
import { MCP_SERVER_NAME, type Harness } from "./harness.ts";

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
  spawn: (cwd, source = process.env) => ({
    command: process.execPath,
    args: [binEntry()],
    cwd,
    env: agentEnv(source, declaredEnv(source)),
  }),
  // D16: the item tools run without a permission prompt each time. Access levels decide what a call may do, and
  // proposals still wait for the user; every other tool still asks.
  sessionMeta: { claudeCode: { options: { allowedTools: [`mcp__${MCP_SERVER_NAME}__*`] } } },
};
