// Whether a process is alive, from /proc: the service's start lock and the app's wait for a stopped service rely on it.
import { spawn } from "node:child_process";
import { once } from "node:events";

import { expect, test } from "vitest";

import { isAlive, startTimeOf } from "./process-stat.ts";

test("a running process is alive and has a start time", () => {
  expect(isAlive(process.pid)).toBe(true);
  expect(startTimeOf(process.pid)).toMatch(/^\d+$/);
});

test("a process that has exited is gone: not alive, no start time", async () => {
  const child = spawn(process.execPath, ["-e", ""]);
  await once(child, "exit");
  expect(child.pid).toBeDefined();
  expect(isAlive(child.pid ?? 0)).toBe(false);
  expect(startTimeOf(child.pid ?? 0)).toBeUndefined();
});
