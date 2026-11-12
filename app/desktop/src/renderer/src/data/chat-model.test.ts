// What the chat adds to the log fold: each request's title and answer. How entries become items is the fold's
// (shared/src/log-fold.test.ts); order-freedom and key stability are chat-model.append-order.test.ts.
import { expect, test } from "vitest";

import {
  type Body,
  chunk,
  entries,
  permissionAnswered,
  permissionRequested,
  toolCall,
  turnEnded,
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
