// The Claude Code harness's instructions hook: the text as one appended block of the top-level systemPrompt.
import { expect, test } from "vitest";

import { claudeCode } from "./claude-code.ts";

test("the Claude Code harness sends the instructions as the top-level systemPrompt, appended", () => {
  expect(claudeCode.sessionParams?.("## Rules\n")).toEqual({ systemPrompt: { mode: "append", content: [{ type: "text", text: "## Rules\n" }] } });
});
