// The Claude harness's context failures name the step that fixes them, and no internal method name: a /context still
// unanswered at the timeout is a busy agent (try again when idle, or stop it); an answer without a report, or one this
// app can't read, is a claude-agent-acp to update.
import { expect, test } from "vitest";

import type { ContextAgent } from "./harness.ts";
import { claudeContextBreakdown, contextBreakdownOf, contextFailureMessage, type ContextFailure } from "./claude-code.ts";

const BUSY = /didn't answer \/context.*cancelled\. Try again once it is idle, or stop the agent if it stays busy\./;
const UPDATE = /claude-agent-acp.*Update it, then try again\./;

test.each<[string, ContextFailure, RegExp]>([
  ["the prompt still open at the timeout", { promptAnswered: false, reason: "timeout" }, BUSY],
  ["the prompt answered without a report", { promptAnswered: true, reason: "timeout" }, UPDATE],
  ["an unreadable report", { promptAnswered: true, reason: "unreadable", fields: ["total_tokens"] }, UPDATE],
])("%s names its remedy and no internal method", (_what, failure, remedy) => {
  const message = contextFailureMessage(failure);
  expect(message).toMatch(remedy);
  expect(message).not.toMatch(remedy === BUSY ? UPDATE : BUSY);
  expect(message).not.toContain("_claude");
});

test("a report without the fields the breakdown needs says to update Claude Code and names the fields", () => {
  expect(() => contextBreakdownOf({ model: "claude-sample-model", categories: [] }, undefined)).toThrow(
    /claude-agent-acp.*Update it, then try again\..*total_tokens.*raw_max_tokens/s,
  );
});

test("a /context the agent never answers ends at the report's timeout with the busy remedy", async () => {
  const agent: ContextAgent = {
    prompt: () => new Promise(() => undefined),
    nextExt: (_method, _match, timeoutMs) => new Promise((_, reject) => setTimeout(() => reject(new Error("no report")), timeoutMs)),
    home: undefined,
  };
  await expect(claudeContextBreakdown(agent, 20)).rejects.toThrow(BUSY);
});
