// The e2e checks drive the app by the names in e2e/switch-names.ts; the app reads them in e2e-switches.ts. Each name
// is fed with a value other than its default, so a misspelt name on either side shows here as the default coming
// back (an e2e would otherwise run without its switch and fail, or pass, for another reason).
import { afterEach, describe, expect, test } from "vitest";

import { RECORDED_NOTIFICATIONS, SWITCH } from "../../e2e/switch-names.ts";
import { readE2eSwitches, recordE2eNotification, type E2eSwitches } from "./e2e-switches.ts";

type Case = { name: keyof typeof SWITCH; value: string; read: (switches: E2eSwitches) => unknown; expected: unknown };

const CASES: Case[] = [
  { name: "workspace", value: "/home/sam/projects/bakery", read: (s) => s.workspace, expected: "/home/sam/projects/bakery" },
  { name: "serviceEntry", value: "/opt/wombat/test/entry.ts", read: (s) => s.serviceEntry, expected: "/opt/wombat/test/entry.ts" },
  { name: "quitAnswer", value: "stop", read: (s) => s.quitAnswer, expected: "stop" },
  { name: "quitDontAsk", value: "1", read: (s) => s.quitDontAsk, expected: true },
  { name: "restartAnswer", value: "restart", read: (s) => s.restartAnswer, expected: "restart" },
  { name: "stopAnswer", value: "stop", read: (s) => s.stopAnswer, expected: "stop" },
];

const on = { [SWITCH.e2e]: "1" };

describe("the e2e switch names the checks use are the ones the app reads", () => {
  test("SWITCH.e2e turns the switches on", () => {
    expect(readE2eSwitches({})).toBeUndefined();
    expect(readE2eSwitches(on)).toBeDefined();
  });

  test("every other name in SWITCH has a case below", () => {
    const named = Object.keys(SWITCH).filter((key) => key !== "e2e").sort();
    expect(CASES.map(({ name }) => name).sort()).toEqual(named);
  });

  test.each(CASES)("$name ($value) reaches the app", ({ name, value, read, expected }) => {
    const without = readE2eSwitches(on);
    if (without === undefined) throw new Error("the switches are off with WOMBAT_E2E=1");
    // The value must differ from the default, or a misspelt name couldn't show.
    expect(read(without), `${value} is ${SWITCH[name]}'s default`).not.toEqual(expected);
    const withIt = readE2eSwitches({ ...on, [SWITCH[name]]: value });
    if (withIt === undefined) throw new Error("the switches are off with WOMBAT_E2E=1");
    expect(read(withIt)).toEqual(expected);
  });

  describe("RECORDED_NOTIFICATIONS", () => {
    afterEach(() => {
      delete (globalThis as Record<string, unknown>)[RECORDED_NOTIFICATIONS];
    });

    test("is the global the app records its notifications in", () => {
      recordE2eNotification({ title: "Wombat", body: "An agent is waiting for you" });
      expect((globalThis as Record<string, unknown>)[RECORDED_NOTIFICATIONS]).toEqual([{ title: "Wombat", body: "An agent is waiting for you" }]);
    });
  });
});
