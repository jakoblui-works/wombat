import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, onTestFinished, test } from "vitest";

import { agentEnv } from "./env.ts";
import { startAgentProcess } from "./harness.ts";

test("startAgentProcess passes args and cwd literally, with no shell in between", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "a b;$(x) "));
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }));
  const literal = "a b;$(echo pwned) `id` 'q' \"d\" | > * && x";

  const child = startAgentProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write(JSON.stringify({ argv: process.argv.slice(1), cwd: process.cwd() }))", literal],
    cwd,
    env: agentEnv(process.env),
  });
  onTestFinished(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });

  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.resume();
  const code = await new Promise<number | null>((done) => child.once("close", done));

  expect(code).toBe(0);
  expect(JSON.parse(stdout)).toEqual({ argv: [literal], cwd: realpathSync(cwd) });
});
