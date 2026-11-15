// What a change to the right side sends. The service refuses a draft equal to the agent's version and a DELETE with no
// draft, and writes exactly the bytes it gets: so texts compare exactly, line endings and the final newline included.
import { expect, test } from "vitest";

import { draftAction } from "./draft-action.ts";

const AGENT = "# Stock\n\nFlour: 40 kg\nButter: 30 kg\n";
const MINE = "# Stock\n\nFlour: 38 kg\nButter: 30 kg\n";

test.each<[string, string, string, string | undefined, "save" | "clear" | "none"]>([
  ["back to the agent's text with a draft saved", AGENT, AGENT, MINE, "clear"],
  ["back to the agent's text with no draft", AGENT, AGENT, undefined, "none"],
  ["equal to my saved draft", AGENT, MINE, MINE, "none"],
])("%s", (_name, agent, mine, saved, want) => {
  expect(draftAction(agent, mine, saved)).toBe(want);
});
