// The log fold: what a text item keeps, and which item is the row's message.
import { describe, expect, test } from "vitest";

import { emptyFold, foldEntry, foldLog, keepAll, lastMainMessage, permissionOf } from "./log-fold.ts";
import {
  type Body,
  chunk as message,
  diffContent,
  entries,
  inSession,
  permissionAnswered,
  permissionRequested,
  plan,
  shape,
  textContent,
  thought as reasoning,
  toolCall as call,
  toolUpdate,
  turnEnded,
  UNSHOWN,
  user,
} from "../test/log-entries.ts";

const MAIN = "session-main";
const SUB = "session-sub";

/**
 * Folds the bodies, numbered from seq 1, into a fresh state for the main session; for `mainSessionId` when one is
 * passed, or with none given (found from the log) when undefined is passed.
 */
const fold = (bodies: Body[], keepText: (kept: string, chunk: string) => string = keepAll, ...given: [mainSessionId?: string]) => {
  const state = emptyFold(given.length > 0 ? given[0] : MAIN);
  for (const entry of entries(bodies)) foldEntry(state, entry, { keepText });
  return state;
};

const texts = (state: ReturnType<typeof emptyFold>): [string, string][] =>
  state.items.flatMap((item) => (item.kind === "agent" || item.kind === "reasoning" ? [[item.kind, item.text] as [string, string]] : []));

// The service folds with `keepForExcerpt`, so a long message costs it a bounded string; a fold that kept the
// whole text would still give the right excerpt, so nothing else sees it.
describe("keepText", () => {
  /** Keeps the first five characters: only ever drops text. */
  const firstFive = (kept: string, more: string): string => (kept + more).slice(0, 5);

  test("a text item holds keepText applied chunk by chunk, from its first chunk on, for messages and reasoning in any session", () => {
    const state = fold(
      [
        message("Opening hours ", "msg-1"),
        message("are 9-17", "msg-1"),
        reasoning("Che"),
        reasoning("ck the file"),
        inSession(message("Menu"), SUB),
        inSession(message(" is fine"), SUB),
        // One chunk alone: kept through keepText too, not only when a second chunk joins it.
        message("Done, all good."),
      ],
      firstFive,
    );
    expect(texts(state)).toEqual([
      ["agent", "Openi"],
      ["reasoning", "Check"],
      ["agent", "Menu "],
      ["agent", "Done,"],
    ]);
  });
});

// The row's message (`AgentSummary.lastText`) is the latest main-session agent message. The check "The row and
// the chat agree" calls this function on both sides, so only this test sees it pick the wrong item.
test.each<[string, Body[], string | undefined]>([
  ["the main message, not a sub-agent's after it", [message("Asking a helper."), inSession(message("Menu is fine"), SUB)], "Asking a helper."],
  ["the latest main message, not reasoning or a tool after it", [message("Done."), reasoning("Checking"), inSession(call("t2", "Run tests"), MAIN), turnEnded()], "Done."],
  ["the latest main message, not a user message after it", [message("Done."), user("Thanks")], "Done."],
])("lastMainMessage: %s", (_name, bodies, expected) => {
  expect(lastMainMessage(fold(bodies))).toBe(expected);
});

test("lastMainMessage: entries from before sessionId was stored count as the main session's", () => {
  const legacy: Body = { type: "session_update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "From the main session." } } };
  expect(lastMainMessage(fold([legacy], keepAll, undefined))).toBe("From the main session.");
  expect(lastMainMessage(fold([legacy], keepAll, MAIN))).toBe("From the main session.");
});

// How entries become items.

/** The items of the bodies as the chat reads them, with the main session found from the log. */
const itemsOf = (...bodies: Body[]) => foldLog(entries(bodies)).items;

describe("chunks", () => {
  test.each<[string, Body[], [string, string][]]>([
    ["one message's chunks merge, text as sent", [message("Hel", "m1"), message("lo ", "m1"), message(" world\n", "m1")], [["agent", "Hello  world\n"]]],
    ["a new messageId starts a new item", [message("First", "m1"), message("Second", "m2")], [["agent", "First"], ["agent", "Second"]]],
    [
      "a new tool call between them starts a new item",
      [message("Before", "m1"), call("t1", "Read hours.md"), message("After", "m1")],
      [["agent", "Before"], ["tool", "t1"], ["agent", "After"]],
    ],
    [
      "an answer, a plan update or an update to an earlier tool between them doesn't split the message",
      [
        call("t1", "Edit notes.txt"),
        permissionRequested("r1", { toolCallId: "t1" }),
        message("Hel", "m1"),
        permissionAnswered("r1", "allow_once"),
        message("lo", "m1"),
        plan("Edit", "Test"),
        message(" there", "m1"),
        toolUpdate("t1", { status: "completed" }),
        message("!", "m1"),
      ],
      [["tool", "t1"], ["permission", "r1"], ["agent", "Hello there!"]],
    ],
  ])("%s", (_name, bodies, expected) => {
    expect(itemsOf(...bodies).map(shape)).toEqual(expected);
  });
});

test("a tool call takes its updates field by field; an update for an unknown call makes the item where it stands", () => {
  const [tool] = itemsOf(
    call("t1", "Edit notes.txt", { kind: "edit", status: "pending", rawInput: { path: "notes.txt" }, locations: [{ path: "notes.txt" }] }),
    toolUpdate("t1", { status: "in_progress", content: [textContent("editing")] }),
    toolUpdate("t1", { content: [diffContent("notes.txt", "Mon closed", "Mon 9-17")] }),
    toolUpdate("t1", { status: "completed", rawOutput: { ok: true } }),
  );
  expect(tool).toMatchObject({
    kind: "tool",
    toolCallId: "t1",
    title: "Edit notes.txt",
    toolKind: "edit",
    status: "completed",
    input: { path: "notes.txt" },
    output: { ok: true },
    // Replaced by the update that had it, kept by those that didn't; the diff stays in content.
    content: [diffContent("notes.txt", "Mon closed", "Mon 9-17")],
    locations: [{ path: "notes.txt" }],
  });

  const orphan = itemsOf(user("Run the tests"), toolUpdate("t9", { title: "Run npm test", status: "in_progress" }), message("Running"));
  expect(orphan.map(shape)).toEqual([["user", "Run the tests"], ["tool", "t9"], ["agent", "Running"]]);
  expect(orphan[1]).toMatchObject({ title: "Run npm test", status: "in_progress" });
});

test("a null field in a tool call update clears that field: title to an empty one, kind to other", () => {
  const [tool] = itemsOf(
    call("t1", "Run npm test", { kind: "execute", status: "in_progress", content: [textContent("running")], locations: [{ path: "package.json" }] }),
    toolUpdate("t1", { status: null, content: null, locations: null }),
  );
  expect(tool?.kind).toBe("tool");
  if (tool?.kind !== "tool") return;
  expect(tool.status).toBeUndefined();
  expect(tool.content).toEqual([]);
  expect(tool.locations).toEqual([]);
  expect(tool.title).toBe("Run npm test");

  const [cleared] = itemsOf(call("t1", "Run npm test", { kind: "execute" }), toolUpdate("t1", { title: null, kind: null }));
  expect(cleared).toMatchObject({ kind: "tool", title: "", toolKind: "other" });
});

test("the plan is the latest plan update's; a turn is active from a user message until the next turn end", () => {
  expect(fold([])).toMatchObject({ items: [], turnActive: false });
  expect(fold([]).plan).toBeUndefined();
  const during = fold([user("Fix the hours"), plan("Read", "Edit"), message("ok"), plan("Edit", "Test")]);
  expect(during.plan?.map((entry) => entry.content)).toEqual(["Edit", "Test"]);
  expect(during.turnActive).toBe(true);
  expect(fold([user("Fix the hours"), plan("Edit"), turnEnded()]).turnActive).toBe(false);
  expect(fold([user("a"), turnEnded(), user("b")]).turnActive).toBe(true);
});

test("entries no item is made for are ignored, even between chunks of one message", () => {
  const shown: Body[] = [user("Fix"), message("Hel", "m1"), message("lo", "m1"), call("t1", "Read"), turnEnded()];
  // Every unshown entry after every shown one; then the log without them (same seqs for the shown entries).
  const withUnshown = entries(shown.flatMap((body) => [body, ...UNSHOWN]));
  const unshownKinds = new Set<string>(UNSHOWN.map((body) => ("update" in body ? body.update.sessionUpdate : body.type)));
  const without = withUnshown.filter((entry) => !unshownKinds.has(entry.type === "session_update" ? entry.update.sessionUpdate : entry.type));
  expect(without).toHaveLength(shown.length);
  expect(foldLog(withUnshown).items).toEqual(foldLog(without).items);
  expect(foldLog(withUnshown).items.map((item) => item.kind)).toEqual(["user", "agent", "tool", "turn_end"]);
});

test.each<[string, string | undefined]>([
  ["main entries carrying the agent's own sessionId", MAIN],
  ["main entries from before sessionId was stored", undefined],
])("a sub-agent's chunks never merge into the main session's message, and its items carry its sessionId: %s", (_name, mainSession) => {
  const main = (body: Body): Body => (mainSession === undefined ? body : inSession(body, mainSession));
  const sub = (body: Body): Body => inSession(body, SUB);
  const log = itemsOf(
    user("Check the menu and the hours"),
    main(message("Asking a helper. ")),
    // No messageId: on its own it would continue the run.
    sub(message("Menu ")),
    sub(message("is fine")),
    sub(permissionRequested("r-sub", { toolCallId: "t-sub", title: "Read menu.md" })),
  );
  expect(log.map(shape)).toEqual([
    ["user", "Check the menu and the hours"],
    ["agent", "Asking a helper. "],
    ["agent", "Menu is fine"],
    ["permission", "r-sub"],
  ]);
  expect(log[2]?.sessionId).toBe(SUB);
  expect(log[3]?.sessionId).toBe(SUB);
  expect(log[1]?.sessionId).not.toBe(SUB);
});

test("with mainSessionId given, a sub-agent that speaks first is still the one marked", () => {
  const { items } = fold([user("Check the menu"), inSession(message("Menu is fine"), SUB), inSession(message("Done."), MAIN)], keepAll, MAIN);
  expect(items.map((item) => [item.kind, item.sessionId])).toEqual([
    ["user", undefined],
    ["agent", SUB],
    ["agent", undefined],
  ]);
});

// The chat and the row's pending requests both read a request's title and kind through `permissionOf`, so only this
// test sees it pick the wrong source.
test.each<[string, Body[], { title: string; kind: string }]>([
  [
    "the request's own title and kind, over its tool item's",
    [call("t1", "Run tests", { kind: "execute" }), permissionRequested("r1", { toolCallId: "t1", title: "Edit notes.txt", kind: "edit" })],
    { title: "Edit notes.txt", kind: "edit" },
  ],
  ["its tool item's title and kind when it has none", [call("t1", "Run tests", { kind: "execute" }), permissionRequested("r1", { toolCallId: "t1" })], { title: "Run tests", kind: "execute" }],
  ["an empty title and kind other when it has none and no tool item", [permissionRequested("r1", { toolCallId: "t9" })], { title: "", kind: "other" }],
])("permissionOf: %s", (_name, bodies, expected) => {
  expect(permissionOf(foldLog(entries(bodies)), "r1")).toEqual(expected);
});
