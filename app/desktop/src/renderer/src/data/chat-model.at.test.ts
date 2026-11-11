// An item's time: a merged item shows when it began.
import { expect, test } from "vitest";

import { atFor, chunk, entries, permissionRequested, thought, toolCall, toolUpdate } from "../../../../test/log-entries.ts";
import { chatModel } from "./chat-model.ts";

test("a merged item's at is its first entry's", () => {
  const { items } = chatModel(
    entries([chunk("Hel", "m1"), chunk("lo", "m1"), thought("a"), thought("b"), toolUpdate("t1", { status: "in_progress" }), toolCall("t1", "Edit"), toolUpdate("t1", { status: "completed" }), permissionRequested("r1", { toolCallId: "t1" })]),
  );
  expect(items.map((item) => [item.kind, item.at])).toEqual([
    ["agent", atFor(1)],
    ["reasoning", atFor(3)],
    ["tool", atFor(5)],
    ["permission", atFor(8)],
  ]);
});
