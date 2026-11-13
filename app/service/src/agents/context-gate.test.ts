// What a context request does next, given what the running agent is doing and the commands it last listed.
import { describe, expect, test } from "vitest";

import { contextGate } from "./context-gate.ts";

const idle = { reporting: false, command: "context", commands: ["context", "compact"], turn: false, hidden: false };

describe("contextGate", () => {
  test.each([
    ["a report in flight is shared, even while a turn and a hidden turn run", { reporting: true, turn: true, hidden: true }, "join"],
    ["a report in flight is shared, even before the agent lists its commands", { reporting: true, commands: undefined }, "join"],
    ["the command missing from the latest list refuses before a running turn", { commands: ["compact"], turn: true }, "unsupported"],
    ["no command list yet refuses before a running hidden turn", { commands: undefined, hidden: true }, "unsupported"],
    ["a running turn refuses as turn-busy, before a hidden turn", { turn: true, hidden: true }, "turn_busy"],
    ["a running hidden turn refuses as hidden-busy", { hidden: true }, "hidden_busy"],
    ["a harness without a command isn't gated by the list", { command: undefined, commands: undefined }, "run"],
    ["a harness without a command still waits for a turn", { command: undefined, commands: [], turn: true }, "turn_busy"],
    ["an idle agent listing the command runs a report", {}, "run"],
  ] as const)("%s", (_, state, expected) => {
    expect(contextGate({ ...idle, ...state })).toBe(expected);
  });
});
