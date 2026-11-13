// The main commands' allow-list (interface-S1, "Whether an id is a main command", in src/shared/bridge.ts; tested here, in
// main's project, because src/shared has no tsconfig of its own): main runs a command from the page
// only when isMainCommandId says it is one, so it must take exactly the listed ids and nothing that merely looks like,
// coerces to, or is inherited by one. The trust-boundary e2e checks main's handler uses it.
import { expect, test } from "vitest";

import { isMainCommandId, MAIN_COMMAND_IDS } from "../shared/bridge.ts";

test("isMainCommandId takes every listed id, and no other value: near misses, prototype names, non-strings, wrapped ids", () => {
  for (const id of MAIN_COMMAND_IDS) expect(isMainCommandId(id), id).toBe(true);

  const refused: unknown[] = [
    "",
    "app.quit ",
    " app.quit",
    "APP.QUIT",
    "app",
    "zoom",
    "app.relaunch",
    "view.split.right",
    "toString",
    "__proto__",
    "constructor",
    "hasOwnProperty",
    "length",
    "0",
    0,
    42,
    true,
    null,
    undefined,
    {},
    { id: "app.quit" },
    // Coerce to a listed id: String(["app.quit"]) and `["app.quit"] in table` both read "app.quit".
    ["app.quit"],
    ["zoom.in"],
    { toString: () => "app.quit" },
  ];
  expect(refused.filter((value) => isMainCommandId(value))).toEqual([]);
});
