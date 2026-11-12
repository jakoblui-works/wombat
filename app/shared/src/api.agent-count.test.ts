// The agents a stop or a quit ends are the ones with a process, whatever their state, and every count of them reads
// the same way.
import { expect, test } from "vitest";

import { agentCountLabel, agentsWithProcess } from "./api.ts";

test("only agents with a process count: a done agent with one does, a working one without one doesn't", () => {
  const agents = [
    { id: "done-with-process", state: "done", hasProcess: true },
    { id: "working-without-process", state: "working", hasProcess: false },
    { id: "stopped", state: "stopped", hasProcess: false },
  ];
  expect(agentsWithProcess(agents).map(({ id }) => id)).toEqual(["done-with-process"]);
});

test("one agent is singular, any other count plural", () => {
  expect(agentCountLabel(1)).toBe("1 agent");
  expect(agentCountLabel(2)).toBe("2 agents");
  expect(agentCountLabel(0)).toBe("0 agents");
});
