// What an agent is doing, its settings and its context use, read from the log fold: `activityOf`,
// `configOf` and `usageOf`. The service's summary and the chat both call these, so a test that compares the two
// can't see them read the log wrongly: only these tables can.
import { expect, test } from "vitest";

import { activityOf, configOf, emptyFold, foldEntry, keepAll } from "./log-fold.ts";
import {
  type Body,
  chunk as message,
  configUpdate,
  entries,
  inSession,
  plan,
  sampleConfig,
  thought,
  toolCall as call,
  toolUpdate,
  turnEnded,
  user,
} from "../test/log-entries.ts";

const MAIN = "session-main";
const SUB = "session-sub";

/** The bodies, numbered from seq 1, folded as the chat folds them, for the main session. */
const fold = (bodies: Body[]) => {
  const state = emptyFold(MAIN);
  for (const entry of entries(bodies)) foldEntry(state, entry, { keepText: keepAll });
  return state;
};

test.each<[string, Body[], { kind: string; title?: string } | null]>([
  ["none once the turn has ended", [user("Fix the hours"), thought("Checking"), message("Done."), turnEnded()], null],
  ["thinking when the turn has only just started", [user("Fix the hours")], { kind: "thinking" }],
  ["writing after a message chunk", [user("Fix the hours"), thought("Checking"), message("The hours are")], { kind: "writing" }],
  [
    "the tool item's title after an update that carries none",
    [user("Fix"), call("t1", "Read hours.md", { status: "pending" }), message("Reading."), toolUpdate("t1", { status: "in_progress" })],
    { kind: "tool", title: "Read hours.md" },
  ],
  ["thinking once the tool has completed", [user("Fix"), call("t1", "Run the tests", { status: "in_progress" }), toolUpdate("t1", { status: "completed" })], { kind: "thinking" }],
])("activityOf: %s", (_name, bodies, activity) => {
  expect(activityOf(fold(bodies))).toStrictEqual(activity);
});

// Only the main session's current turn decides: a sub-agent's work doesn't show as the agent's, and a new turn starts
// from scratch.
test.each<[string, Body[], { kind: string; title?: string } | null]>([
  ["a sub-agent's thought after main writing leaves writing", [user("Fix"), message("Asking a helper."), inSession(thought("Menu?"), SUB)], { kind: "writing" }],
  [
    "a sub-agent's message after a main tool leaves the tool",
    [user("Fix"), call("t1", "Run the tests", { status: "in_progress" }), inSession(message("Menu is fine"), SUB)],
    { kind: "tool", title: "Run the tests" },
  ],
  ["a new turn while the last one's tool still runs starts thinking", [user("Fix"), call("t1", "Run the tests", { status: "in_progress" }), user("Again")], { kind: "thinking" }],
])("activityOf: %s", (_name, bodies, activity) => {
  expect(activityOf(fold(bodies))).toStrictEqual(activity);
});

test("configOf gives the latest main-session options, kept across turns; a sub-agent's never replace them", () => {
  const first = sampleConfig("fast-model", false);
  const second = sampleConfig("deep-model", true);
  expect(configOf(fold([]))).toBeUndefined();
  expect(configOf(fold([user("Fix"), message("Done."), turnEnded()]))).toBeUndefined();
  // As the service stores them: the session's options before the first message, then each change.
  expect(configOf(fold([configUpdate(first), user("Fix"), turnEnded(), user("Again")]))).toEqual(first);
  expect(configOf(fold([configUpdate(first), user("Fix"), configUpdate(second)]))).toEqual(second);
  expect(configOf(fold([inSession(configUpdate(first), MAIN), inSession(configUpdate(second), SUB)]))).toEqual(first);
  expect(configOf(fold([configUpdate(first), inSession(configUpdate(second), SUB), plan("Edit")]))).toEqual(first);
});
