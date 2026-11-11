// The main session the caller names wins over the first session in the log.
import { expect, test } from "vitest";

import { chunk, entries, inSession, user } from "../../../../test/log-entries.ts";
import { chatModel } from "./chat-model.ts";

test("with mainSessionId given, a sub-agent that speaks first is still the one marked", () => {
  const log = entries([user("Check the menu"), inSession(chunk("Menu is fine"), "session-sub"), inSession(chunk("Done."), "session-main")]);
  const items = chatModel(log, { mainSessionId: "session-main" }).items;
  expect(items.map((item) => [item.kind, item.sessionId])).toEqual([
    ["user", undefined],
    ["agent", "session-sub"],
    ["agent", undefined],
  ]);
});
