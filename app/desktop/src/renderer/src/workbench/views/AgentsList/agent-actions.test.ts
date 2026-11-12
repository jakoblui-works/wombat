import { expect, test } from "vitest";

import { canStop } from "./agent-actions.ts";

test("Stop is offered exactly when the agent has a process, whatever its state", () => {
  expect(canStop({ hasProcess: true })).toBe(true);
  expect(canStop({ hasProcess: false })).toBe(false);
});
