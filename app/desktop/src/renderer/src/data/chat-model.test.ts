// T8: how chatModel turns a log into the chat's items (interface-S4, "chatModel"). Order-freedom and key stability
// are the lasting check in chat-model.append-order.test.ts.
import { describe, expect, test } from "vitest";

import {
  type Body,
  chunk,
  diffContent,
  entries,
  permissionAnswered,
  permissionRequested,
  plan,
  textContent,
  thought,
  toolCall,
  toolUpdate,
  turnEnded,
  inSession,
  UNSHOWN,
  user,
} from "../../../../test/log-entries.ts";
import { type ChatItem, chatModel } from "./chat-model.ts";

const items = (...bodies: Body[]): ChatItem[] => chatModel(entries(bodies)).items;

/** An item as [kind, its text or id], to compare item lists by what they show. */
const shape = (item: ChatItem): [string, string] => {
  switch (item.kind) {
    case "user":
    case "agent":
    case "reasoning":
      return [item.kind, item.text];
    case "tool":
      return [item.kind, item.toolCallId];
    case "permission":
      return [item.kind, item.requestId];
    case "turn_end":
      return [item.kind, item.stopReason];
    default:
      return [(item as { kind: string }).kind, ""];
  }
};

describe("chunks", () => {
  test.each<[string, Body[], [string, string][]]>([
    ["one message's chunks merge, text as sent", [chunk("Hel", "m1"), chunk("lo ", "m1"), chunk(" world\n", "m1")], [["agent", "Hello  world\n"]]],
    ["chunks without a messageId merge", [chunk("Open "), chunk("9-17")], [["agent", "Open 9-17"]]],
    ["a new messageId starts a new item", [chunk("First", "m1"), chunk("Second", "m2")], [["agent", "First"], ["agent", "Second"]]],
    [
      "a new tool call between them starts a new item",
      [chunk("Before", "m1"), toolCall("t1", "Read hours.md"), chunk("After", "m1")],
      [["agent", "Before"], ["tool", "t1"], ["agent", "After"]],
    ],
    [
      "a new permission request between them starts a new item",
      [chunk("Before", "m1"), permissionRequested("r1", { toolCallId: "t1", title: "Edit notes.txt" }), chunk("After", "m1")],
      [["agent", "Before"], ["permission", "r1"], ["agent", "After"]],
    ],
    [
      "an answer, a plan update or an update to an earlier tool between them doesn't split the message",
      [
        toolCall("t1", "Edit notes.txt"),
        permissionRequested("r1", { toolCallId: "t1" }),
        chunk("Hel", "m1"),
        permissionAnswered("r1", "allow_once"),
        chunk("lo", "m1"),
        plan("Edit", "Test"),
        chunk(" there", "m1"),
        toolUpdate("t1", { status: "completed" }),
        chunk("!", "m1"),
      ],
      [["tool", "t1"], ["permission", "r1"], ["agent", "Hello there!"]],
    ],
    [
      "thoughts merge into reasoning, apart from the message",
      [thought("Check "), thought("the file"), chunk("Done")],
      [["reasoning", "Check the file"], ["agent", "Done"]],
    ],
    ["a thought between message chunks splits them", [chunk("A"), thought("hm"), chunk("B")], [["agent", "A"], ["reasoning", "hm"], ["agent", "B"]]],
  ])("%s", (_name, bodies, expected) => {
    expect(items(...bodies).map(shape)).toEqual(expected);
  });
});

test("a tool call takes its updates field by field; an update for an unknown call makes the item where it stands", () => {
  const [tool] = items(
    toolCall("t1", "Edit notes.txt", { kind: "edit", status: "pending", rawInput: { path: "notes.txt" }, locations: [{ path: "notes.txt" }] }),
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

  const orphan = items(user("Run the tests"), toolUpdate("t9", { title: "Run npm test", status: "in_progress" }), chunk("Running"));
  expect(orphan.map(shape)).toEqual([["user", "Run the tests"], ["tool", "t9"], ["agent", "Running"]]);
  expect(orphan[1]).toMatchObject({ title: "Run npm test", status: "in_progress" });
});

test("a null field in a tool call update clears that field", () => {
  const [tool] = items(
    toolCall("t1", "Run npm test", { kind: "execute", status: "in_progress", content: [textContent("running")], locations: [{ path: "package.json" }] }),
    toolUpdate("t1", { status: null, content: null, locations: null }),
  );
  expect(tool?.kind).toBe("tool");
  if (tool?.kind !== "tool") return;
  expect(tool.status).toBeUndefined();
  expect(tool.content).toEqual([]);
  expect(tool.locations).toEqual([]);
  expect(tool.title).toBe("Run npm test");
});

test.each<[string, Body[], string | undefined]>([
  ["open while unanswered", [user("Edit"), permissionRequested("r1", { toolCallId: "t1" })], undefined],
  ["the answer's kind", [permissionRequested("r1", { toolCallId: "t1" }), permissionAnswered("r1", "allow_once")], "allow_once"],
  ["cancelled once a turn end follows it", [permissionRequested("r1", { toolCallId: "t1" }), turnEnded("cancelled")], "cancelled"],
  [
    "answered when the answer comes after a cancel",
    [permissionRequested("r1", { toolCallId: "t1" }), turnEnded("cancelled"), permissionAnswered("r1", "reject_once")],
    "reject_once",
  ],
  ["another request's answer leaves it open", [permissionRequested("r1", { toolCallId: "t1" }), permissionAnswered("r2", "allow_once")], undefined],
  ["a turn end before it doesn't cancel it", [user("a"), turnEnded(), user("b"), permissionRequested("r1", { toolCallId: "t1" })], undefined],
])("a permission's answer: %s", (_name, bodies, answer) => {
  const permission = items(...bodies).find((item) => item.kind === "permission");
  expect(permission).toBeDefined();
  expect(permission && "answer" in permission ? permission.answer : undefined).toBe(answer);
});

test("a permission sits where it was asked, titled by its tool call, else the tool item with its id, else empty", () => {
  const log = items(
    toolCall("t1", "Edit notes.txt"),
    permissionRequested("r-own", { toolCallId: "t1", title: "Edit notes.txt (lines 1-4)" }),
    permissionRequested("r-tool", { toolCallId: "t1" }),
    chunk("waiting"),
    permissionRequested("r-none", { toolCallId: "t-unknown" }),
  );
  expect(log.map(shape)).toEqual([
    ["tool", "t1"],
    ["permission", "r-own"],
    ["permission", "r-tool"],
    ["agent", "waiting"],
    ["permission", "r-none"],
  ]);
  const titles = Object.fromEntries(log.flatMap((item) => (item.kind === "permission" ? [[item.requestId, item.title]] : [])));
  expect(titles).toEqual({ "r-own": "Edit notes.txt (lines 1-4)", "r-tool": "Edit notes.txt", "r-none": "" });
});

test("the plan is the latest plan update's; a turn is active from a user message until the next turn end", () => {
  expect(chatModel([])).toEqual({ items: [], turnActive: false });
  const during = chatModel(entries([user("Fix the hours"), plan("Read", "Edit"), chunk("ok"), plan("Edit", "Test")]));
  expect(during.plan?.map((entry) => entry.content)).toEqual(["Edit", "Test"]);
  expect(during.turnActive).toBe(true);
  const after = chatModel(entries([user("Fix the hours"), plan("Edit"), turnEnded()]));
  expect(after.turnActive).toBe(false);
  expect(chatModel(entries([user("a"), turnEnded(), user("b")])).turnActive).toBe(true);
});

test("entries the chat doesn't show are ignored, even between chunks of one message", () => {
  const shown: Body[] = [user("Fix"), chunk("Hel", "m1"), chunk("lo", "m1"), toolCall("t1", "Read"), turnEnded()];
  // Every unshown entry after every shown one; then the log without them (same seqs for the shown entries).
  const withUnshown = entries(shown.flatMap((body) => [body, ...UNSHOWN]));
  const without = withUnshown.filter((entry) => !isUnshown(entry));
  expect(without).toHaveLength(shown.length);
  expect(chatModel(withUnshown)).toEqual(chatModel(without));
  expect(chatModel(withUnshown).items.map((item) => item.kind)).toEqual(["user", "agent", "tool", "turn_end"]);
});

const UNSHOWN_KINDS = new Set<string>(UNSHOWN.map((body) => ("update" in body ? body.update.sessionUpdate : body.type)));
const isUnshown = (entry: { type: string; update?: { sessionUpdate: string } }): boolean =>
  UNSHOWN_KINDS.has(entry.type === "session_update" && entry.update ? entry.update.sessionUpdate : entry.type);

test.each<[string, string | undefined]>([
  ["main entries carrying the agent's own sessionId", "session-main"],
  ["main entries from before sessionId was stored", undefined],
])("a sub-agent's chunks never merge into the main session's message, and its items carry its sessionId: %s", (_name, mainSession) => {
  const main = (body: Body): Body => (mainSession === undefined ? body : inSession(body, mainSession));
  const sub = (body: Body): Body => inSession(body, "session-sub");
  const log = items(
    user("Check the menu and the hours"),
    main(chunk("Asking a helper. ")),
    // No messageId: on its own it would continue the run.
    sub(chunk("Menu ")),
    sub(chunk("is fine")),
    sub(permissionRequested("r-sub", { toolCallId: "t-sub", title: "Read menu.md" })),
  );
  expect(log.map(shape)).toEqual([
    ["user", "Check the menu and the hours"],
    ["agent", "Asking a helper. "],
    ["agent", "Menu is fine"],
    ["permission", "r-sub"],
  ]);
  const sessionOf = (item: ChatItem | undefined): unknown => (item as { sessionId?: unknown } | undefined)?.sessionId;
  expect(sessionOf(log[2])).toBe("session-sub");
  expect(sessionOf(log[3])).toBe("session-sub");
  expect(sessionOf(log[1])).not.toBe("session-sub");
});
