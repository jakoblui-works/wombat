// The page's Restart, in any connection state: it asks only when an agent has a process, and Cancel leaves it all
// running; otherwise it stops the service and starts the code on disk. The agents, question, stop and start are stubs
// (quit.test.ts runs it over a real connection to an incompatible service).
import type { AgentSummary } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { restartService } from "./quit.ts";

const restart = (agents: AgentSummary[] | undefined, answer: boolean) => {
  const steps: string[] = [];
  const restarted = restartService({
    agents: () => Promise.resolve(agents),
    confirm: (running) => {
      steps.push(`asked ${String(running)}`);
      return Promise.resolve(answer);
    },
    stop: () => {
      steps.push("stopped");
      return Promise.resolve();
    },
    start: () => {
      steps.push("started");
      return Promise.resolve();
    },
    log: () => undefined,
  });
  return { restarted, steps };
};

const withProcess = [{ state: "done", hasProcess: true }, { state: "stopped", hasProcess: false }] as AgentSummary[];

test("with an agent process, Restart asks; Cancel stops and starts nothing", async () => {
  const { restarted, steps } = restart(withProcess, false);
  expect(await restarted).toBe(false);
  expect(steps).toEqual(["asked 1"]);
});
