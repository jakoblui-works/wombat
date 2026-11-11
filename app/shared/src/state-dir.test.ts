// The state folder holds the service's database and log; a relative XDG_STATE_HOME must never put them somewhere
// that depends on the current folder.
import { expect, test } from "vitest";

import { stateDir } from "./state-dir.ts";

test("stateDir takes an absolute XDG_STATE_HOME, else ~/.local/state, and refuses without an absolute HOME", () => {
  expect(stateDir({ XDG_STATE_HOME: "/home/dev/.state", HOME: "/home/dev" })).toBe("/home/dev/.state/wombat");
  expect(stateDir({ XDG_STATE_HOME: "state", HOME: "/home/dev" })).toBe("/home/dev/.local/state/wombat");
  expect(stateDir({ HOME: "/home/dev" })).toBe("/home/dev/.local/state/wombat");
  expect(() => stateDir({ HOME: "home/dev" })).toThrow(/HOME/);
});
