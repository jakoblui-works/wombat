// Whether a start may go ahead next to the service the discovery file names: never next to ours that runs but doesn't
// answer (hung), but a file from an older service, without its process's start time, whose pid doesn't answer is a
// leftover whose pid may be another process's by now, so a start goes ahead as before.
import { API_VERSION } from "@wombat/shared";
import type { DiscoveryFile } from "@wombat/shared/discovery";
import { writePrivateFile } from "@wombat/shared/private-file";
import { startTimeOf } from "@wombat/shared/process-stat";
import { expect, test } from "vitest";

import { serviceSandbox } from "../../test/service-sandbox.ts";
import { answeringService, ServiceNotAnswering } from "./service-start.ts";

/** A file naming this live process, on a port nothing listens on (1 is privileged, so no test service has it). */
const unanswering = (processStart?: string): DiscoveryFile => ({
  apiVersion: API_VERSION,
  port: 1,
  pid: process.pid,
  token: "answering-token-0123456789",
  workspace: "/workspaces/bakery",
  ...(processStart === undefined ? {} : { processStart }),
});

test("a file without the process's start time whose live pid doesn't answer is no service: a start may go ahead", async () => {
  const sandbox = serviceSandbox();
  writePrivateFile(sandbox.discoveryPath, JSON.stringify(unanswering()));
  await expect(answeringService(sandbox.discoveryPath)).resolves.toBeUndefined();
});

test("a file with the process's start time whose pid doesn't answer is ours and hung: it fails naming the pid", async () => {
  const sandbox = serviceSandbox();
  writePrivateFile(sandbox.discoveryPath, JSON.stringify(unanswering(startTimeOf(process.pid))));
  const outcome = answeringService(sandbox.discoveryPath);
  await expect(outcome).rejects.toBeInstanceOf(ServiceNotAnswering);
  await expect(outcome).rejects.toThrow(`pid ${String(process.pid)}`);
});
