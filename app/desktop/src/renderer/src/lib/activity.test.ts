import { expect, test } from "vitest";

import { activityLabel } from "./activity.ts";

test.each([
  [{ kind: "thinking" as const }, "Thinking…"],
  [{ kind: "writing" as const }, "Writing…"],
  [{ kind: "tool" as const, title: "Bash" }, "Running Bash"],
  [{ kind: "tool" as const }, "Running a tool"],
])("activityLabel of %j is %s", (activity, label) => {
  expect(activityLabel(activity)).toBe(label);
});
