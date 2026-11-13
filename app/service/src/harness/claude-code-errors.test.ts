// The Claude harness's context failures name the step that fixes them, and no internal method name: a /context still
// unanswered at the timeout is a busy agent (try again when idle, or stop it); an answer without a report, or one this
// app can't read, is a claude-agent-acp to update.
import { expect, test } from "vitest";

import type { ContextAgent } from "./harness.ts";
import { claudeContextBreakdown } from "./claude-code.ts";

const BUSY = /didn't answer \/context.*cancelled\. Try again once it is idle, or stop the agent if it stays busy\./;

test("a /context the agent never answers ends at the report's timeout with the busy remedy", async () => {
  const agent: ContextAgent = {
    prompt: () => new Promise(() => undefined),
    nextExt: (_method, _match, timeoutMs) => new Promise((_, reject) => setTimeout(() => reject(new Error("no report")), timeoutMs)),
    home: undefined,
  };
  await expect(claudeContextBreakdown(agent, 20)).rejects.toThrow(BUSY);
});
