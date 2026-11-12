// An open-agent request main sends before the page subscribes reaches the page's first subscriber.
import { expect, test } from "vitest";

import { heldEvents } from "./held-events.ts";

test("an event before any subscriber is given to the first one, once; later events go to every subscriber", () => {
  const events = heldEvents<string>();
  events.take("a1");
  const first: string[] = [];
  const second: string[] = [];
  events.subscribe((id) => first.push(id));
  events.subscribe((id) => second.push(id));
  events.take("a2");
  expect([first, second]).toEqual([["a1", "a2"], ["a2"]]);
});
