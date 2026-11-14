// What a change to the right side sends. The service refuses a draft equal to the agent's version and a DELETE with no
// draft, and writes exactly the bytes it gets: so texts compare exactly, line endings and the final newline included.
import { expect, test } from "vitest";

import { draftAction } from "./draft-action.ts";

const AGENT = "# Stock\n\nFlour: 40 kg\nButter: 30 kg\n";
const AGENT_CRLF = "# Stock\r\n\r\nFlour: 40 kg\r\nButter: 30 kg\r\n";
const MINE = "# Stock\n\nFlour: 38 kg\nButter: 30 kg\n";

test.each<[string, string, string, string | undefined, "save" | "clear" | "none"]>([
  ["a first edit", AGENT, MINE, undefined, "save"],
  ["back to the agent's text with a draft saved", AGENT, AGENT, MINE, "clear"],
  ["back to the agent's CRLF text with a draft saved", AGENT_CRLF, AGENT_CRLF, AGENT_CRLF.replace("40", "38"), "clear"],
  ["back to the agent's text with no draft", AGENT, AGENT, undefined, "none"],
  ["equal to my saved draft", AGENT, MINE, MINE, "none"],
  ["only the final newline differs from the agent's", AGENT, AGENT.slice(0, -1), undefined, "save"],
  ["only one line ending differs from the agent's", AGENT_CRLF, AGENT_CRLF.replace("Flour: 40 kg\r\n", "Flour: 40 kg\n"), undefined, "save"],
  ["only one line ending differs from my saved draft", AGENT, MINE.replace("Flour: 38 kg\n", "Flour: 38 kg\r\n"), MINE, "save"],
])("%s", (_name, agent, mine, saved, want) => {
  expect(draftAction(agent, mine, saved)).toBe(want);
});
