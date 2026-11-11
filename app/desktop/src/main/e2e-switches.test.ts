// The e2e switches steer the app's dialogs and the service it runs; only an e2e run may turn them on.
import { expect, test } from "vitest";

import { readE2eSwitches } from "./e2e-switches.ts";

const switches = {
  WOMBAT_E2E_WORKSPACE: "/tmp/wombat-e2e/workspace",
  WOMBAT_E2E_SERVICE_ENTRY: "/tmp/wombat-e2e/entry.ts",
  WOMBAT_E2E_RESTART_ANSWER: "restart",
};

test("the switches are ignored unless WOMBAT_E2E=1", () => {
  for (const flag of [undefined, "0", "true", ""]) {
    const env = flag === undefined ? switches : { ...switches, WOMBAT_E2E: flag };
    expect(readE2eSwitches(env), String(flag)).toBeUndefined();
  }
  expect(readE2eSwitches({ ...switches, WOMBAT_E2E: "1" })).toEqual({
    workspace: "/tmp/wombat-e2e/workspace",
    serviceEntry: "/tmp/wombat-e2e/entry.ts",
    restartAnswer: "restart",
  });
});
