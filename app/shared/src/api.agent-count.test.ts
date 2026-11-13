// The agents a stop or a quit ends are the ones with a process, whatever their state, and every count of them reads
// the same way.
import { expect, test } from "vitest";

import { agentCountLabel, agentsWithProcess, chatAccess, HARNESS_FEATURE, hasProcess } from "./api.ts";

test("only agents with a process count: a done agent with one does, a working one without one doesn't", () => {
  const agents = [
    { id: "done-with-process", state: "done", hasProcess: true },
    { id: "working-without-process", state: "working", hasProcess: false },
    { id: "stopped", state: "stopped", hasProcess: false },
  ];
  expect(agentsWithProcess(agents).map(({ id }) => id)).toEqual(["done-with-process"]);
});

test("one agent is singular, any other count plural", () => {
  expect(agentCountLabel(1)).toBe("1 agent");
  expect(agentCountLabel(2)).toBe("2 agents");
  expect(agentCountLabel(0)).toBe("0 agents");
});

test("an agent is running exactly when it has a process, whatever its state", () => {
  expect(hasProcess({ hasProcess: true })).toBe(true);
  expect(hasProcess({ hasProcess: false })).toBe(false);
});

// S2d (T19-13): a chat without a process goes on when its harness resumes, and is closed otherwise.
test("a chat is running with a process, resumable without one when its harness offers resume, else closed", () => {
  const resumes = [HARNESS_FEATURE.context, HARNESS_FEATURE.resume];
  expect(chatAccess({ hasProcess: true }, resumes)).toBe("running");
  expect(chatAccess({ hasProcess: true }, [])).toBe("running");
  expect(chatAccess({ hasProcess: false }, resumes)).toBe("resumable");
  expect(chatAccess({ hasProcess: false }, [HARNESS_FEATURE.context])).toBe("closed");
});
