// S2d (D28): the indicator's tooltip says what happens next: a message starts the agent again, or only a new agent goes on.
import { expect, test } from "vitest";

import { notRunningHint } from "./NotRunning.tsx";

test("the hint says a message starts a resumable agent, and a closed one needs a new agent", () => {
  expect(notRunningHint("resumable")).toBe("Your next message starts it again");
  expect(notRunningHint("closed")).toBe("Start a new agent to continue");
});
