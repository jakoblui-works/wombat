// Open-agent requests wait for the restored layout, then go straight through.
import { expect, test } from "vitest";

import { openAgents } from "./open-agents.ts";

test("requests before the handler is attached are applied, in order, when it is; later ones at once", () => {
  const queue = openAgents();
  queue.push("a1");
  queue.push("a2");
  const opened: string[] = [];
  queue.open((id) => opened.push(id));
  queue.push("a3");
  expect(opened).toEqual(["a1", "a2", "a3"]);
});

test("a detached handler gets nothing more; requests wait for the next one", () => {
  const queue = openAgents();
  const first: string[] = [];
  const detach = queue.open((id) => first.push(id));
  detach();
  queue.push("a1");
  const second: string[] = [];
  queue.open((id) => second.push(id));
  expect([first, second]).toEqual([[], ["a1"]]);
});
