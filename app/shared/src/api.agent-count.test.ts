// The agents a stop or a quit ends are the ones with a process, whatever their state.
import { expect, test } from "vitest";

import { agentsWithProcess } from "./api.ts";

test("only agents with a process count: a done agent with one does, a working one without one doesn't", () => {
  const agents = [
    { id: "done-with-process", state: "done", hasProcess: true },
    { id: "working-without-process", state: "working", hasProcess: false },
    { id: "stopped", state: "stopped", hasProcess: false },
  ];
  expect(agentsWithProcess(agents).map(({ id }) => id)).toEqual(["done-with-process"]);
});
