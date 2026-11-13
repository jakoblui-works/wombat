// What the chat adds to the log fold: each request's title and answer. How entries become items is the fold's
// (shared/src/log-fold.test.ts); order-freedom and key stability are chat-model.append-order.test.ts.
import { expect, test } from "vitest";

import {
  type Body,
  entries,
  permissionAnswered,
  permissionRequested,
  turnEnded,
  user,
} from "../../../../../shared/test/log-entries.ts";
import { type ChatItem, chatModel } from "./chat-model.ts";

const items = (...bodies: Body[]): ChatItem[] => chatModel(entries(bodies)).items;

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
])("a permission's answer: %s", (_name, bodies, answer) => {
  const permission = items(...bodies).find((item) => item.kind === "permission");
  expect(permission).toBeDefined();
  expect(permission && "answer" in permission ? permission.answer : undefined).toBe(answer);
});
