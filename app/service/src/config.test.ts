// The service's config comes from the env it is given (never process.env behind its back), and every
// bad value is refused with a message naming the variable, so the process can exit saying what to set.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import { DEFAULT_PORT, readConfig } from "./config.ts";
import { defaultStorePath } from "./store/paths.ts";

// realpath, so the test holds whether or not the config resolves links.
const base = realpathSync(mkdtempSync(join(tmpdir(), "wombat-config-")));
const runtimeDir = join(base, "run");
mkdirSync(runtimeDir);
afterAll(() => rmSync(base, { recursive: true, force: true }));

// A HOME no test machine has, so a config that reads process.env instead of `env` gets a different store path.
const valid: NodeJS.ProcessEnv = {
  HOME: join(base, "home-of-test-user"),
  XDG_RUNTIME_DIR: runtimeDir,
};

const without = (env: NodeJS.ProcessEnv, name: string): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([key]) => key !== name));

test("readConfig defaults to the default port and store path, and reads every value from the env it is given", () => {
  expect(readConfig(valid)).toEqual({
    port: DEFAULT_PORT,
    storePath: defaultStorePath(valid),
    discoveryPath: join(runtimeDir, "wombat", "service.json"),
  });

  const store = join(base, "elsewhere", "service.db");
  // WOMBAT_STORE replaces the default, so HOME isn't needed then.
  const overridden = { ...without(valid, "HOME"), WOMBAT_PORT: "15001", WOMBAT_STORE: store };
  expect(readConfig(overridden)).toMatchObject({ port: 15001, storePath: store });
  // 0: any free port (the discovery file says which).
  expect(readConfig({ ...valid, WOMBAT_PORT: "0" }).port).toBe(0);
});

describe("readConfig refuses a bad value with a message naming the variable", () => {
  const rows: { what: string; env: NodeJS.ProcessEnv; names: string }[] = [
    { what: "WOMBAT_STORE relative", env: { ...valid, WOMBAT_STORE: "state/service.db" }, names: "WOMBAT_STORE" },
    { what: "no usable HOME without WOMBAT_STORE", env: without(valid, "HOME"), names: "HOME" },
  ];

  test.each(rows)("$what", ({ env, names }) => {
    expect(() => readConfig(env)).toThrow(names);
  });
});
