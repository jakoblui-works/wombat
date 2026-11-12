// S2c, T15 (row T15-3): `/context` as the whole message is the app's own command, but only when the agent's harness
// offers the breakdown; anything else, and `/context` for a harness without the feature, goes to the agent.
import { expect, test } from "vitest";

import { appCommand } from "./composer-state.ts";

test.each<[string, string[], "context" | undefined]>([
  ["/context", ["context"], "context"],
  ["  /context\n", ["context"], "context"],
  ["/context", [], undefined],
  ["/context", ["other-feature"], undefined],
  ["/context now", ["context"], undefined],
  ["/contexts", ["context"], undefined],
  ["Show me /context", ["context"], undefined],
  ["", ["context"], undefined],
])("%j with features %j is %s", (text, features, command) => {
  expect(appCommand(text, features)).toBe(command);
});
