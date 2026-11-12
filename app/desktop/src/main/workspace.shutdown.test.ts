// The workspace control's stop: a service whose process runs (runningService) but doesn't answer fails the stop,
// saying how to stop it, instead of passing for done (a quit would then leave it behind); a discovery file whose
// process is gone, or whose pid another process has taken since, is nothing to stop.
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

import { API_VERSION } from "@wombat/shared";
import type { DiscoveryFile } from "@wombat/shared/discovery";
import { writePrivateFile } from "@wombat/shared/private-file";
import { startTimeOf } from "@wombat/shared/process-stat";
import { expect, test } from "vitest";

import { serviceSandbox, type ServiceSandbox } from "../../test/service-sandbox.ts";
import { ServiceStartFailed } from "./service-start.ts";
import { workspaceControl } from "./workspace.ts";

const control = (sandbox: ServiceSandbox) =>
  workspaceControl({
    env: sandbox.env,
    settingsFile: sandbox.settingsFile,
    serviceEntry: "/nonexistent/entry.ts",
    chooseFolder: () => Promise.reject(new Error("the folder dialog wasn't expected")),
    confirmRestart: () => Promise.reject(new Error("the restart box wasn't expected")),
    log: () => undefined,
  });

/** A port nothing listens on any more. */
const closedPort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};

const discoveryNaming = async (sandbox: ServiceSandbox, pid: number, processStart: string | undefined): Promise<void> => {
  const file: DiscoveryFile = {
    apiVersion: API_VERSION,
    port: await closedPort(),
    pid,
    token: "silent-service-token-0123456789",
    ...(processStart === undefined ? {} : { processStart }),
  };
  writePrivateFile(sandbox.discoveryPath, JSON.stringify(file));
};

test("a service whose process runs but doesn't answer fails the stop, naming the pid and how to stop it", async () => {
  const sandbox = serviceSandbox();
  // This test's own process, with its own start time: the service as far as the file goes, and not answering.
  await discoveryNaming(sandbox, process.pid, startTimeOf(process.pid));

  const stopping = control(sandbox).shutdown();
  await expect(stopping).rejects.toThrow(ServiceStartFailed);
  await expect(stopping).rejects.toThrow(`kill ${String(process.pid)}`);
});

test.each<[string, number, () => string | undefined]>([
  // Above the kernel's pid limit, so no process has it.
  ["a process that's gone", 2 ** 22 + 1, () => "1"],
  // This test's process, but not started when the file says: the pid was reused after the service crashed.
  ["a pid another process has taken since", process.pid, () => `${startTimeOf(process.pid) ?? ""}0`],
])("a discovery file left by %s is nothing to stop", async (_name, pid, processStart) => {
  const sandbox = serviceSandbox();
  await discoveryNaming(sandbox, pid, processStart());

  await expect(control(sandbox).shutdown()).resolves.toBeUndefined();
});
