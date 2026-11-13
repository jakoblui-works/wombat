import { expect, test } from "vitest";

import "./claude-ui.ts";
import { CLAUDE_HARNESS_ID } from "../../../../../../shared/test/context-cases.ts";
import { hiddenOptionsFor } from "../../workbench/views/Chat/Composer/ComposerFooter/slots.ts";

test("the Claude module hides the agent option for Claude Code only", () => {
  expect(hiddenOptionsFor(CLAUDE_HARNESS_ID)).toEqual(["agent"]);
  expect(hiddenOptionsFor("fake")).toEqual([]);
});
