import { expect, test } from "vitest";

import { agentEnv } from "./env.ts";

const allowlisted = {
  HOME: "/home/dev",
  PATH: "/usr/local/bin:/usr/bin",
  USER: "dev",
  LANG: "en_US.UTF-8",
  TERM: "xterm-256color",
  SHELL: "/bin/zsh",
  XDG_RUNTIME_DIR: "/run/user/1000",
  XDG_CONFIG_HOME: "/home/dev/.config",
};

test.each<{ name: string; source: NodeJS.ProcessEnv; declared?: Record<string, string>; expected: Record<string, string> }>([
  { name: "keeps every allowlisted variable with its value, XDG_* included", source: allowlisted, expected: allowlisted },
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
    name: "leaves variables missing from the source unset, not empty",
    source: { HOME: undefined, PATH: "/usr/bin", XDG_DATA_HOME: undefined },
    expected: { PATH: "/usr/bin" },
  },
  { name: "an empty source gives an empty environment", source: {}, expected: {} },
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
