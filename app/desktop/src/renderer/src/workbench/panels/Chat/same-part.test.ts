// A part rebuilt from the same entries counts as the same (its block isn't rendered again); any changed field doesn't.
import { expect, test } from "vitest";

import { chatModel } from "../../../data/chat-model.ts";
import { entries, permissionRequested, toolCall, user } from "../../../../../../../shared/test/log-entries.ts";
import { samePart } from "./same-part.ts";

test("parts rebuilt from the same log are the same; an appended update changes only its own part", () => {
  const log = entries([
    user("Run the tests"),
    toolCall("tool-run", "Run the tests", { kind: "execute", status: "pending", rawInput: { command: "pnpm test" } }),
    permissionRequested("req-run", { toolCallId: "tool-run" }),
  ]);
  const before = chatModel(log).parts;
  const again = chatModel([...log]).parts;
  expect(before.map((part, index) => samePart(part, again[index] ?? part))).toEqual([true, true, true]);

  const renamed = chatModel(log.map((entry) => (entry.type === "user_message" ? { ...entry, text: "Run the tests again" } : entry))).parts;
  expect(before.map((part, index) => samePart(part, renamed[index] ?? part))).toEqual([false, true, true]);
});
