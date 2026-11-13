// The quit question's words: which button gives which answer, and the "still running" notice's count.
import { expect, test } from "vitest";

import { quitChoice, quitQuestion } from "./quit-question.ts";

test("each of the quit question's buttons gives its own answer; the box's Cancel (Escape) is Cancel", () => {
  const box = quitQuestion(2);
  const answers = Object.fromEntries((box.buttons ?? []).map((label, index) => [label, quitChoice(index, false).answer]));
  expect(answers).toEqual({ "Keep running": "leave", "Stop agents and quit": "stop", Cancel: "cancel" });
  expect(quitChoice(box.cancelId ?? -1, false).answer).toBe("cancel");
  expect(quitChoice(0, true).dontAsk).toBe(true);
});
