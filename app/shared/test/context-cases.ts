// Drift fixture (S2c, T13/T16): one invented /context report in Claude's shape and the ContextBreakdown the service
// must make of it. The service checks its mapper against the pair (service/src/harness/claude-code-context.test.ts),
// the desktop's Claude module renders the breakdown (harnesses/claude/claude-ui.test.tsx), so the list ids and the
// harness id the module matches on can't drift from what the service sends. Invented values only.
import type { ContextBreakdown } from "../src/api.ts";

/** The service's Claude Code harness id, which the desktop's Claude module registers its UI under. */
export const CLAUDE_HARNESS_ID = "claude-code";

/** The agent's HOME the sample's memory files live under. */
export const SAMPLE_HOME = "/home/sandbox-user";

/** A `context_usage` as claude-agent-acp forwards it (SDKContextUsage), every list non-empty. */
export const SAMPLE_CONTEXT_USAGE = {
  model: "claude-sample-model",
  total_tokens: 48_200,
  raw_max_tokens: 200_000,
  percentage: 24,
  categories: [
    { name: "System prompt", tokens: 3_100, kind: "used" },
    { name: "Messages", tokens: 40_000, kind: "used" },
    { name: "MCP tools (deferred)", tokens: 9_000, kind: "deferred" },
    { name: "Autocompact buffer", tokens: 33_000, kind: "buffer" },
    { name: "Free space", tokens: 118_800, kind: "free" },
  ],
  memory_files: [
    { path: "/home/sandbox-user/.claude/CLAUDE.md", type: "User", tokens: 1_200 },
    { path: "/srv/bakery-site/CLAUDE.md", type: "Project", tokens: 800 },
  ],
  agents: [{ agent_type: "pastry-reviewer", source: "projectSettings", tokens: 400 }],
  skills: [{ name: "menu-formatter", source: "userSettings", tokens: 300 }],
  mcp_tools: [{ name: "mcp__wombat__list_items", server_name: "wombat", tokens: 500 }],
} as const;

/** What the service makes of SAMPLE_CONTEXT_USAGE with SAMPLE_HOME. */
export const SAMPLE_BREAKDOWN: ContextBreakdown = {
  model: "claude-sample-model",
  used: 48_200,
  size: 200_000,
  categories: SAMPLE_CONTEXT_USAGE.categories.map((category) => ({ ...category })),
  lists: [
    {
      id: "memory_files",
      title: "Memory files",
      rows: [
        { name: "~/.claude/CLAUDE.md", detail: "User", tokens: 1_200 },
        { name: "/srv/bakery-site/CLAUDE.md", detail: "Project", tokens: 800 },
      ],
    },
    { id: "custom_agents", title: "Custom agents", rows: [{ name: "pastry-reviewer", detail: "projectSettings", tokens: 400 }] },
    { id: "skills", title: "Skills", rows: [{ name: "menu-formatter", detail: "userSettings", tokens: 300 }] },
    { id: "mcp_tools", title: "MCP tools", rows: [{ name: "mcp__wombat__list_items", detail: "wombat", tokens: 500 }] },
  ],
};
