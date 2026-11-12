// Whether the app's service runs, the one place that decides it: a discovery file counts only while its process runs
// and is the one the file names (its start time), so a crash's leftover file, or one whose pid another process took
// since, is no service. A file from an older service, without the start time, is taken at its pid.
import { API_VERSION } from "@wombat/shared";
import type { DiscoveryFile } from "@wombat/shared/discovery";
import { writePrivateFile } from "@wombat/shared/private-file";
import { startTimeOf } from "@wombat/shared/process-stat";
import { expect, test } from "vitest";

import { serviceSandbox } from "../../test/service-sandbox.ts";
import { runningService } from "./service-start.ts";

/** A pid above the kernel's limit, so no process has it. */
const GONE = 2 ** 22 + 1;

const fileAt = (pid: number, processStart?: string): DiscoveryFile => ({
  apiVersion: API_VERSION,
  port: 1,
  pid,
  token: "running-service-token-0123456789",
  ...(processStart === undefined ? {} : { processStart }),
});

const ownStart = (): string => startTimeOf(process.pid) ?? "";

test.each<[string, () => DiscoveryFile, boolean]>([
  ["a live process started when the file says", () => fileAt(process.pid, ownStart()), true],
  ["a file from an older service (no start time) whose pid is alive", () => fileAt(process.pid), true],
  ["a pid that's gone", () => fileAt(GONE, "1"), false],
  ["a pid reused by a process started at another time", () => fileAt(process.pid, `${ownStart()}0`), false],
])("%s: running is %s", (_name, file, running) => {
  const sandbox = serviceSandbox();
  const written = file();
  writePrivateFile(sandbox.discoveryPath, JSON.stringify(written));
  expect(runningService(sandbox.discoveryPath)).toEqual(running ? { file: written, pid: written.pid } : undefined);
});

test("no discovery file: no service", () => {
  expect(runningService(serviceSandbox().discoveryPath)).toBeUndefined();
});
