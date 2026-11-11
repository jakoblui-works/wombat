// An item rebuilt from the same entries counts as the same (its block isn't rendered again); any changed field doesn't.
import { expect, test } from "vitest";

import { chatModel } from "../../../data/chat-model.ts";
import { entries, permissionRequested, toolCall, user } from "../../../../../../test/log-entries.ts";
import { sameItem } from "./same-item.ts";

test("items rebuilt from the same log are the same; an appended update changes only its own item", () => {
  const log = entries([
    user("Run the tests"),
    toolCall("tool-run", "Run the tests", { kind: "execute", status: "pending", rawInput: { command: "pnpm test" } }),
    permissionRequested("req-run", { toolCallId: "tool-run" }),
  ]);
  const before = chatModel(log).items;
  const again = chatModel([...log]).items;
  expect(before.map((item, index) => sameItem(item, again[index] ?? item))).toEqual([true, true, true]);

  const renamed = chatModel(log.map((entry) => (entry.type === "user_message" ? { ...entry, text: "Run the tests again" } : entry))).items;
  expect(before.map((item, index) => sameItem(item, renamed[index] ?? item))).toEqual([false, true, true]);
});
