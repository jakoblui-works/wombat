// A service of ours that runs but doesn't answer (hung, or stopped by a debugger) must not get a second service
// started next to it: the two would fight over the store and the port, and the hung one would run on unseen. The
// start fails instead, naming the pid and how to stop it. The hung service is a socket in this process that accepts
// and never answers, with a discovery file naming this process as it was started.
import { createServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";

import type { DiscoveryFile } from "@wombat/shared/discovery";
import { writePrivateFile } from "@wombat/shared/private-file";
import { startTimeOf } from "@wombat/shared/process-stat";
import { API_VERSION } from "@wombat/shared";
import { expect, onTestFinished, test } from "vitest";

import { saveSettings } from "./settings.ts";
import { FAKE_SERVICE_ENTRY, serviceSandbox, type ServiceSandbox } from "../../test/service-sandbox.ts";
import { workspaceControl } from "./workspace.ts";

const hungService = async (sandbox: ServiceSandbox, workspace: string): Promise<DiscoveryFile> => {
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  const processStart = startTimeOf(process.pid);
  const file: DiscoveryFile = {
    apiVersion: API_VERSION,
    port: (server.address() as AddressInfo).port,
    pid: process.pid,
    token: "hung-service-token-0123456789",
    workspace,
    ...(processStart === undefined ? {} : { processStart }),
  };
  writePrivateFile(sandbox.discoveryPath, JSON.stringify(file));
  return file;
};

test.each(["restart", "open"] as const)(
  "%s next to a live service of ours that doesn't answer fails naming its pid, and starts no second service",
  async (how) => {
    const sandbox = serviceSandbox();
    const workspace = sandbox.workspace("bakery");
    saveSettings(sandbox.settingsFile, { version: 1, workspace, workspaces: {}, askOnQuit: true });
    const hung = await hungService(sandbox, workspace);
    const control = workspaceControl({
      env: sandbox.env,
      settingsFile: sandbox.settingsFile,
      serviceEntry: FAKE_SERVICE_ENTRY,
      chooseFolder: () => Promise.reject(new Error("the folder dialog wasn't expected")),
      confirmRestart: () => Promise.reject(new Error("the restart box wasn't expected")),
      log: () => undefined,
    });

    const started =
      how === "restart"
        ? control.restart()
        : control.open().then((opened) => {
            if (opened === undefined) throw new Error("open was cancelled");
            return opened.service;
          });
    const outcome = await started.then(
      () => "started",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(outcome, "a service was started (or taken) next to the hung one").not.toBe("started");
    expect(outcome, "the failure doesn't name the hung service's pid").toContain(String(hung.pid));
    expect(sandbox.starts(), "a second service was started").toEqual([]);
  },
  30_000,
);
