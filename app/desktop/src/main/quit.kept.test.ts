// A quit that keeps the service running waits for the "still running" announcement before it lets the app exit, so
// the notification reaches the desktop first.
import type { AgentSummary } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { decideQuit } from "./quit.ts";
import { Settings } from "./settings.ts";

test("Keep: the quit settles only once the announcement has", async () => {
  let announce = () => undefined as void;
  const announced = new Promise<void>((resolve) => {
    announce = resolve;
  });
  let decided: boolean | undefined;
  void decideQuit({
    settings: () => Settings.parse({}),
    updateSettings: () => undefined,
    idle: () => Promise.resolve(),
    agents: () => Promise.resolve([{ state: "working", hasProcess: true } as AgentSummary]),
    ask: () => Promise.resolve({ answer: "leave", dontAsk: false }),
    stop: () => Promise.reject(new Error("the stop wasn't expected")),
    notifyKept: () => announced,
    log: () => undefined,
  }).then((quit) => (decided = quit));

  await new Promise((resolve) => setImmediate(resolve));
  expect(decided, "the quit went ahead before the announcement reached the desktop").toBeUndefined();
  announce();
  await expect.poll(() => decided).toBe(true);
});
