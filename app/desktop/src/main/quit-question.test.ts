// The quit question's words: which button gives which answer, and the "still running" notice's count.
import { expect, test } from "vitest";

import { keptNotice, quitChoice, quitQuestion } from "./quit-question.ts";

test("each of the quit question's buttons gives its own answer; the box's Cancel (Escape) is Cancel", () => {
  const box = quitQuestion(2);
  const answers = Object.fromEntries((box.buttons ?? []).map((label, index) => [label, quitChoice(index, false).answer]));
  expect(answers).toEqual({ "Keep running": "leave", "Stop agents and quit": "stop", Cancel: "cancel" });
  expect(quitChoice(box.cancelId ?? -1, false).answer).toBe("cancel");
  expect(quitChoice(0, true).dontAsk).toBe(true);
});

test("the question names the count of agents, and says the service keeps running in the background", () => {
  expect(quitQuestion(1).message).toBe("1 agent is still running.");
  expect(quitQuestion(3).message).toBe("3 agents are still running.");
  expect(quitQuestion(undefined).message).toBe("Agents may still be running.");
  expect(quitQuestion(1).detail).toMatch(/keeps running in the background until you stop it/);
});

test("the kept notice names the agents, singular or plural", () => {
  expect(keptNotice(1)).toEqual({ title: "Wombat", body: "The agent service is still running with 1 agent. Open Wombat to stop it." });
  expect(keptNotice(2).body).toBe("The agent service is still running with 2 agents. Open Wombat to stop it.");
  expect(keptNotice(undefined).body).toBe("The agent service is still running. Open Wombat to stop it.");
});
