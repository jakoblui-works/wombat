import { expect, test } from "vitest";

import { agentEnv } from "./env.ts";

test.each<{ name: string; source: NodeJS.ProcessEnv; declared?: Record<string, string>; expected: Record<string, string> }>([
  {
    name: "drops everything else, including names that only look like allowlisted ones",
    source: {
      HOME: "/home/dev",
      EDITOR: "vim",
      NODE_OPTIONS: "--inspect",
      SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
      HOMEDIR: "/home/other",
      MY_PATH: "/opt/bin",
      MY_XDG_DIR: "/x",
      xdg_config_home: "/y",
    },
    expected: { HOME: "/home/dev" },
  },
  {
    name: "adds what the harness declares",
    source: { HOME: "/home/dev", TERM: "xterm" },
    declared: { CLAUDE_CONFIG_DIR: "/home/dev/.claude", TERM: "dumb" },
    expected: { HOME: "/home/dev", TERM: "dumb", CLAUDE_CONFIG_DIR: "/home/dev/.claude" },
  },
])("agentEnv $name", ({ source, declared, expected }) => {
  // toStrictEqual: a variable set to undefined or "" would not count as left out.
  expect(agentEnv(source, declared)).toStrictEqual(expected);
});
