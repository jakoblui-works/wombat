// The expected answers come from the rules written out as plain flags (recorded, ending, turn, hidden, closed), never
// from `next` or the predicates, so a change to either shows up here.
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  type AgentPhase,
  endingByService,
  isBeingRemoved,
  isClosed,
  isHidden,
  isTurnOpen,
  mayMintToken,
  mayRecord,
  next,
  type PhaseEvent,
  recordsAgent,
  STARTING,
  stateOnClose,
  takesCalls,
  writesTurnEndOnClose,
} from "./phase.ts";

type Flags = {
  recorded: boolean;
  ending: "stop" | "remove" | undefined;
  turn: boolean;
  hidden: boolean;
  exited: boolean;
  closed: boolean;
};

const fresh: Flags = { recorded: false, ending: undefined, turn: false, hidden: false, exited: false, closed: false };

const fromFlags = (f: Flags) => ({
  isClosed: f.closed,
  endingByService: f.ending !== undefined,
  mayRecord: f.ending === undefined,
  recordsAgent: f.recorded,
  takesCalls: f.recorded && f.ending === undefined,
  isTurnOpen: f.turn,
  isHidden: f.hidden,
  isBeingRemoved: f.ending === "remove",
  mayMintToken: f.ending === undefined && !f.exited && !f.closed,
  writesTurnEndOnClose: f.recorded && f.turn && f.ending !== "remove",
  stateOnClose: !f.recorded ? undefined : f.ending === "stop" ? "stopped" : f.ending === "remove" ? undefined : "error",
});

const asked = (phase: AgentPhase) => ({
  isClosed: isClosed(phase),
  endingByService: endingByService(phase),
  mayRecord: mayRecord(phase),
  recordsAgent: recordsAgent(phase),
  takesCalls: takesCalls(phase),
  isTurnOpen: isTurnOpen(phase),
  isHidden: isHidden(phase),
  isBeingRemoved: isBeingRemoved(phase),
  mayMintToken: mayMintToken(phase),
  writesTurnEndOnClose: writesTurnEndOnClose(phase),
  stateOnClose: stateOnClose(phase),
});

const recorded: PhaseEvent = { type: "recorded" };
const turnStarted: PhaseEvent = { type: "turnStarted" };
const turnEnded: PhaseEvent = { type: "turnEnded" };
const hiddenStarted: PhaseEvent = { type: "hiddenStarted" };
const hiddenEnded: PhaseEvent = { type: "hiddenEnded" };
const stop: PhaseEvent = { type: "endRequested", why: "stop" };
const remove: PhaseEvent = { type: "endRequested", why: "remove" };
const exited: PhaseEvent = { type: "exited" };
const closed: PhaseEvent = { type: "closed" };

const run = (events: readonly PhaseEvent[]) => events.reduce(next, STARTING);

const live = { ...fresh, recorded: true };
const closedFlags = { ...fresh, closed: true };

describe("agent phase", () => {
  test.each<[string, PhaseEvent[], Flags]>([
    ["a starting agent holds its updates and takes no calls", [], fresh],
    ["recording makes the agent take calls", [recorded], live],
    ["a sent message opens a turn", [recorded, turnStarted], { ...live, turn: true }],
    ["a context request opens a hidden turn", [recorded, hiddenStarted], { ...live, hidden: true }],
    ["a written turn end closes the turn", [recorded, turnStarted, turnEnded], live],
    ["a finished context report closes the hidden turn", [recorded, hiddenStarted, hiddenEnded], live],
    ["a hidden turn doesn't start during a turn", [recorded, turnStarted, hiddenStarted], { ...live, turn: true }],
    ["a turn doesn't start during a hidden turn", [recorded, hiddenStarted, turnStarted], { ...live, hidden: true }],

    ["a process exiting before it is recorded may still be recorded", [exited], { ...fresh, exited: true }],
    ["a stop before recording refuses the recording", [stop], { ...fresh, ending: "stop" }],
    ["a remove before recording refuses the recording", [remove], { ...fresh, ending: "remove" }],
    ["an exited process recorded late takes calls and closes as an error", [exited, recorded], { ...live, exited: true }],

    ["stopping an idle agent", [recorded, stop], { ...live, ending: "stop" }],
    ["removing an idle agent", [recorded, remove], { ...live, ending: "remove" }],
    ["an idle agent's process exiting", [recorded, exited], { ...live, exited: true }],
    ["stopping mid-turn keeps the turn open", [recorded, turnStarted, stop], { ...live, turn: true, ending: "stop" }],
    ["removing mid-turn writes no turn end", [recorded, turnStarted, remove], { ...live, turn: true, ending: "remove" }],
    ["exiting mid-turn keeps the turn open", [recorded, turnStarted, exited], { ...live, turn: true, exited: true }],
    ["stopping during a hidden turn still drops its output", [recorded, hiddenStarted, stop], { ...live, hidden: true, ending: "stop" }],
    ["removing during a hidden turn still drops its output", [recorded, hiddenStarted, remove], { ...live, hidden: true, ending: "remove" }],
    ["exiting during a hidden turn still drops its output", [recorded, hiddenStarted, exited], { ...live, hidden: true, exited: true }],

    ["a turn opens on an exited process", [recorded, exited, turnStarted], { ...live, turn: true, exited: true }],
    ["a turn end closes the turn on an exited process", [recorded, turnStarted, exited, turnEnded], { ...live, exited: true }],
    ["a hidden turn opens on an exited process", [recorded, exited, hiddenStarted], { ...live, hidden: true, exited: true }],
    ["a finished context report closes the hidden turn while stopping", [recorded, hiddenStarted, stop, hiddenEnded], { ...live, ending: "stop" }],

    ["stopping an exited process", [recorded, exited, stop], { ...live, exited: true, ending: "stop" }],
    ["removing an exited process", [recorded, turnStarted, exited, remove], { ...live, turn: true, exited: true, ending: "remove" }],
    ["a stop doesn't undo a remove", [recorded, turnStarted, remove, stop], { ...live, turn: true, ending: "remove" }],
    ["a remove overrides a stop", [recorded, turnStarted, stop, remove], { ...live, turn: true, ending: "remove" }],
    ["exiting doesn't undo a stop", [recorded, stop, exited], { ...live, exited: true, ending: "stop" }],
    ["exiting doesn't undo a remove", [recorded, remove, exited], { ...live, exited: true, ending: "remove" }],

    ["closing a starting agent", [closed], closedFlags],
    ["closing an idle agent", [recorded, closed], closedFlags],
    ["closing a stopping agent mid-turn", [recorded, turnStarted, stop, closed], closedFlags],
  ])("%s", (_, events, flags) => {
    expect(asked(run(events))).toEqual(fromFlags(flags));
  });

  test("a closed phase ignores every event", () => {
    const event = fc.constantFrom(recorded, turnStarted, turnEnded, hiddenStarted, hiddenEnded, stop, remove, exited, closed);
    fc.assert(
      fc.property(fc.array(event, { maxLength: 6 }), fc.array(event, { maxLength: 6 }), (before, after) => {
        expect(asked(run([...before, closed, ...after]))).toEqual(fromFlags(closedFlags));
      }),
    );
  });
});
