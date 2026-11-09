import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";

import { expect, test } from "vitest";

import { claudeCode } from "./claude-code.ts";

// The installed claude-agent-acp's `bin` entry, read from its package.json.
const packageJson = createRequire(import.meta.url).resolve("@agentclientprotocol/claude-agent-acp/package.json");
const { bin } = JSON.parse(readFileSync(packageJson, "utf8")) as { bin: Record<string, string> };
const binEntry = resolve(dirname(packageJson), bin["claude-agent-acp"] ?? "");

test("the Claude Code harness runs node on claude-agent-acp's bin entry, which exists", () => {
  const spec = claudeCode.spawn("/home/dev/work/repo");
  expect(spec.command).toBe(process.execPath);
  expect(spec.args).toHaveLength(1);
  const [entry = ""] = spec.args;
  expect(isAbsolute(entry)).toBe(true);
  expect(existsSync(entry)).toBe(true);
  expect(realpathSync(entry)).toBe(realpathSync(binEntry));
});

test("the Claude Code command line comes from the harness alone; only cwd follows the caller", () => {
  const cwds = ["/home/dev/work/repo", "/home/dev/a b;$(x)", "/tmp/`touch pwned` && echo | > *"];
  const specs = cwds.map((cwd) => claudeCode.spawn(cwd));
  const [first] = specs;
  for (const [index, spec] of specs.entries()) {
    expect(spec.command).toBe(first?.command);
    expect(spec.args).toEqual(first?.args);
    expect(spec.cwd).toBe(cwds[index]);
  }
  expect(specs.flatMap((spec) => [spec.command, ...spec.args]).join(" ")).not.toMatch(/\$\(x\)|touch pwned/);
});
