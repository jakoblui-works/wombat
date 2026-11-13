// S2c, T13 and T16 (rows T13-11, T13-12, T16-5, and T16-2's service half): `contextBreakdownOf` is the one reader of
// Claude's `context_usage` (SDKContextUsage). Invented reports only. Also T16-1's service half: the harness id the
// desktop's Claude module registers under (shared/test/context-cases.ts) is this harness's.
import { ContextBreakdown } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { CLAUDE_HARNESS_ID, SAMPLE_BREAKDOWN, SAMPLE_CONTEXT_USAGE, SAMPLE_HOME } from "../../../shared/test/context-cases.ts";
import { claudeCode, contextBreakdownOf } from "./claude-code.ts";

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

test("T16-1 (service half): the shared fixture's Claude harness id is the Claude harness's", () => {
  expect(claudeCode.id).toBe(CLAUDE_HARNESS_ID);
});
