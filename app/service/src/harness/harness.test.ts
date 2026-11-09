import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, onTestFinished, test } from "vitest";

import { fakeSystemd, option, runs } from "../../test/fake-systemd.ts";
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

// With a scope, the agent runs through systemd-run, which execs it in place.
test("startAgentProcess with a scope runs the command through systemd-run --user --scope --quiet --collect with the slice, unit and TimeoutStopSec=10s, args literal after --, keeping the agent's pid and stdio", async () => {
  const systemd = fakeSystemd();
  onTestFinished(systemd.remove);
  const cwd = mkdtempSync(join(tmpdir(), "wombat-scope-"));
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }));
  const literal = "a b;$(echo pwned) `id` 'q' \"d\" | > * && x";
  const script = "process.stdout.write(JSON.stringify({ pid: process.pid, argv: process.argv.slice(1) }))";
  const scope = { unit: "wombat-agent-test-unit.scope", slice: "wombattestharness.slice" };

  const child = startAgentProcess(
    { command: process.execPath, args: ["-e", script, literal], cwd, env: agentEnv({ ...process.env, PATH: systemd.binDir }) },
    { scope },
  );
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

  const started = runs(systemd.calls());
  expect(started).toHaveLength(1);
  const [run] = started;
  expect(run?.command).toEqual([process.execPath, "-e", script, literal]);
  expect([...(run?.options ?? [])].sort()).toEqual(
    ["--user", "--scope", "--quiet", "--collect", `--slice=${scope.slice}`, `--unit=${scope.unit}`, "--property=TimeoutStopSec=10s"].sort(),
  );
  expect(option(run?.options ?? [], "unit")).toBe(scope.unit);
  expect(code).toBe(0);
  // Exec'd in place: the process the service holds is the agent itself, on the service's pipes.
  expect(JSON.parse(stdout)).toEqual({ pid: child.pid, argv: [literal] });
});
