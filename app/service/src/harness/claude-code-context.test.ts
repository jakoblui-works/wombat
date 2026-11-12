// S2c, T13 and T16 (rows T13-11, T13-12, T16-5, and T16-2's service half): `contextBreakdownOf` is the one reader of
// Claude's `context_usage` (SDKContextUsage). Invented reports only. Also T16-1's service half: the harness id the
// desktop's Claude module registers under (shared/test/context-cases.ts) is this harness's.
import fc from "fast-check";
import { ContextBreakdown } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { CLAUDE_HARNESS_ID, SAMPLE_BREAKDOWN, SAMPLE_CONTEXT_USAGE, SAMPLE_HOME } from "../../../shared/test/context-cases.ts";
import { claudeCode, contextBreakdownOf } from "./claude-code.ts";

const KINDS = ["used", "free", "buffer", "deferred"] as const;
const name = fc.string({ minLength: 1, maxLength: 20 });
const tokens = fc.nat({ max: 2_000_000 });

const usage = fc.record(
  {
    model: name,
    total_tokens: tokens,
    raw_max_tokens: tokens,
    percentage: fc.nat({ max: 150 }),
    categories: fc.array(fc.record({ name, tokens, kind: fc.constantFrom(...KINDS) }), { maxLength: 6 }),
    memory_files: fc.array(fc.record({ path: name, type: name, tokens }), { maxLength: 3 }),
    agents: fc.array(fc.record({ agent_type: name, source: name, tokens }), { maxLength: 3 }),
    skills: fc.array(fc.record({ name, source: name, tokens }), { maxLength: 3 }),
    mcp_tools: fc.array(fc.record({ name, server_name: name, tokens }), { maxLength: 3 }),
  },
  { requiredKeys: ["model", "total_tokens", "raw_max_tokens", "percentage", "categories", "memory_files", "agents", "mcp_tools"] },
);

test("T13-11: every number and category kept, and exactly the non-empty lists, in order, with their rows", () => {
  fc.assert(
    fc.property(usage, (report) => {
      const lists = [
        { id: "memory_files", title: "Memory files", rows: report.memory_files.map((row) => ({ name: row.path, detail: row.type, tokens: row.tokens })) },
        { id: "custom_agents", title: "Custom agents", rows: report.agents.map((row) => ({ name: row.agent_type, detail: row.source, tokens: row.tokens })) },
        { id: "skills", title: "Skills", rows: (report.skills ?? []).map((row) => ({ name: row.name, detail: row.source, tokens: row.tokens })) },
        { id: "mcp_tools", title: "MCP tools", rows: report.mcp_tools.map((row) => ({ name: row.name, detail: row.server_name, tokens: row.tokens })) },
      ].filter((list) => list.rows.length > 0);

      expect(contextBreakdownOf(report, undefined)).toEqual({
        model: report.model,
        used: report.total_tokens,
        size: report.raw_max_tokens,
        categories: report.categories,
        lists,
      });
    }),
  );
});

test("T16-2 (service half): the shared sample maps to the shared breakdown, list ids and all", () => {
  expect(contextBreakdownOf(SAMPLE_CONTEXT_USAGE, SAMPLE_HOME)).toEqual(SAMPLE_BREAKDOWN);
});

test("T13-12: a report with fields this app doesn't know, an unknown category kind, over_limit and no skills still maps", () => {
  const newer = {
    ...SAMPLE_CONTEXT_USAGE,
    total_tokens: 210_000,
    over_limit: { tokens_over: 10_000, kind: "compaction_window" },
    report_version: 7,
    categories: [...SAMPLE_CONTEXT_USAGE.categories, { name: "Reserved for later", tokens: 700, kind: "reserved", colour_hint: "teal" }],
    memory_files: SAMPLE_CONTEXT_USAGE.memory_files.map((row) => ({ ...row, loaded_by: "startup" })),
    skills: undefined,
  };

  expect(ContextBreakdown.parse(contextBreakdownOf(newer, SAMPLE_HOME))).toEqual({
    ...SAMPLE_BREAKDOWN,
    used: 210_000,
    categories: [...SAMPLE_BREAKDOWN.categories, { name: "Reserved for later", tokens: 700, kind: "used" }],
    lists: SAMPLE_BREAKDOWN.lists.filter((list) => list.id !== "skills"),
  });
});

test("T16-5: a memory file under the agent's HOME shows with ~; one that only shares the prefix, or lies elsewhere, doesn't", () => {
  const home = "/home/sandbox-user";
  const memory = (path: string) => ({ path, type: "User", tokens: 100 });
  const report = {
    ...SAMPLE_CONTEXT_USAGE,
    memory_files: [memory(`${home}/.claude/CLAUDE.md`), memory(`${home}x/CLAUDE.md`), memory(`/srv${home}/CLAUDE.md`), memory("/srv/bakery-site/CLAUDE.md")],
  };

  const names = contextBreakdownOf(report, home).lists.find((list) => list.id === "memory_files")?.rows.map((row) => row.name);
  expect(names).toEqual(["~/.claude/CLAUDE.md", `${home}x/CLAUDE.md`, `/srv${home}/CLAUDE.md`, "/srv/bakery-site/CLAUDE.md"]);
});

test("T16-1 (service half): the shared fixture's Claude harness id is the Claude harness's", () => {
  expect(claudeCode.id).toBe(CLAUDE_HARNESS_ID);
});
