// The service's config comes from the env it is given (never process.env behind its back), and every
// bad value is refused with a message naming the variable, so the process can exit saying what to set.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import { DEFAULT_PORT, readConfig } from "./config.ts";
import { defaultStorePath } from "./store/paths.ts";

// Real folders: the workspace must exist. realpath, so the test holds whether or not the config resolves links.
const base = realpathSync(mkdtempSync(join(tmpdir(), "wombat-config-")));
const workspace = join(base, "workspace");
const runtimeDir = join(base, "run");
const aFile = join(base, "a-file");
mkdirSync(workspace);
mkdirSync(runtimeDir);
writeFileSync(aFile, "");
afterAll(() => rmSync(base, { recursive: true, force: true }));

// A HOME no test machine has, so a config that reads process.env instead of `env` gets a different store path.
const valid: NodeJS.ProcessEnv = {
  HOME: join(base, "home-of-test-user"),
  WOMBAT_WORKSPACE: workspace,
  XDG_RUNTIME_DIR: runtimeDir,
};

const without = (env: NodeJS.ProcessEnv, name: string): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([key]) => key !== name));

test("readConfig defaults to port 14900 and the default store path, and reads every value from the env it is given", () => {
  expect(DEFAULT_PORT).toBe(14900);
  expect(readConfig(valid)).toEqual({
    port: DEFAULT_PORT,
    workspaceRoot: workspace,
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

test("WOMBAT_ITEMS is optional, and when set is read as the items root", () => {
  expect(readConfig(valid)).not.toHaveProperty("itemsRoot");
  expect(readConfig({ ...valid, WOMBAT_ITEMS: workspace }).itemsRoot).toBe(workspace);
});

describe("readConfig refuses a bad value with a message naming the variable", () => {
  const rows: { what: string; env: NodeJS.ProcessEnv; names: string }[] = [
    ...["abc", "", "80abc", "1.5", "-1", "65536", " 80"].map((port) => ({
      what: `WOMBAT_PORT ${JSON.stringify(port)}`,
      env: { ...valid, WOMBAT_PORT: port },
      names: "WOMBAT_PORT",
    })),
    { what: "WOMBAT_WORKSPACE unset", env: without(valid, "WOMBAT_WORKSPACE"), names: "WOMBAT_WORKSPACE" },
    { what: "WOMBAT_WORKSPACE empty", env: { ...valid, WOMBAT_WORKSPACE: "" }, names: "WOMBAT_WORKSPACE" },
    { what: "WOMBAT_WORKSPACE relative", env: { ...valid, WOMBAT_WORKSPACE: "workspace" }, names: "WOMBAT_WORKSPACE" },
    {
      what: "WOMBAT_WORKSPACE missing",
      env: { ...valid, WOMBAT_WORKSPACE: join(base, "no-such-folder") },
      names: "WOMBAT_WORKSPACE",
    },
    { what: "WOMBAT_WORKSPACE a file", env: { ...valid, WOMBAT_WORKSPACE: aFile }, names: "WOMBAT_WORKSPACE" },
    { what: "WOMBAT_ITEMS empty", env: { ...valid, WOMBAT_ITEMS: "" }, names: "WOMBAT_ITEMS" },
    { what: "WOMBAT_ITEMS relative", env: { ...valid, WOMBAT_ITEMS: "items" }, names: "WOMBAT_ITEMS" },
    { what: "WOMBAT_ITEMS missing", env: { ...valid, WOMBAT_ITEMS: join(base, "no-such-folder") }, names: "WOMBAT_ITEMS" },
    { what: "WOMBAT_ITEMS a file", env: { ...valid, WOMBAT_ITEMS: aFile }, names: "WOMBAT_ITEMS" },
    { what: "XDG_RUNTIME_DIR unset", env: without(valid, "XDG_RUNTIME_DIR"), names: "XDG_RUNTIME_DIR" },
    { what: "XDG_RUNTIME_DIR relative", env: { ...valid, XDG_RUNTIME_DIR: "run" }, names: "XDG_RUNTIME_DIR" },
    { what: "WOMBAT_STORE relative", env: { ...valid, WOMBAT_STORE: "state/service.db" }, names: "WOMBAT_STORE" },
    { what: "no usable HOME without WOMBAT_STORE", env: without(valid, "HOME"), names: "HOME" },
  ];

  test.each(rows)("$what", ({ env, names }) => {
    expect(() => readConfig(env)).toThrow(names);
  });
});
