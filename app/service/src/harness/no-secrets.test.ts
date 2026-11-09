// Lasting check (silent failure): no secret reaches an agent. Every harness's environment omits WOMBAT_*,
// ANTHROPIC_API_KEY and the service token, however they got into the source or the harness's declaration.
import { tmpdir } from "node:os";

import { afterEach, describe, expect, test, vi } from "vitest";

import { fakeHarness } from "../../test/fake-harness.ts";
import { agentEnv } from "./env.ts";
import type { Harness } from "./harness.ts";
import { defaultHarnesses } from "./registry.ts";

const TOKEN = "tok_3f9c2a71e4b8d6051a7c9e2f";
const API_KEY = "sk-ant-fake-0000000000000000";

const polluted: NodeJS.ProcessEnv = {
  HOME: "/home/dev",
  PATH: "/usr/bin",
  XDG_RUNTIME_DIR: "/run/user/1000",
  WOMBAT_TOKEN: TOKEN,
  WOMBAT_PORT: "14900",
  WOMBAT_SOMETHING_NEW: "x",
  ANTHROPIC_API_KEY: API_KEY,
  // The token's value under a name that isn't allowlisted.
  SERVICE_AUTH: TOKEN,
};

const expectNoSecrets = (env: Record<string, string>) => {
  const names = Object.keys(env);
  expect(names.filter((name) => name.startsWith("WOMBAT_"))).toEqual([]);
  expect(names).not.toContain("ANTHROPIC_API_KEY");
  const values = Object.values(env);
  expect(values.filter((value) => value.includes(TOKEN) || value.includes(API_KEY))).toEqual([]);
};

// Every registered harness, so a future one is covered without editing this test, plus the test-only fake.
const harnesses: Harness[] = [...defaultHarnesses, fakeHarness("reply")];

describe("no secret reaches an agent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("agentEnv omits WOMBAT_*, ANTHROPIC_API_KEY and the token from the source", () => {
    expectNoSecrets(agentEnv(polluted));
  });

  test("agentEnv omits them even when a harness declares them", () => {
    expectNoSecrets(agentEnv(polluted, { WOMBAT_TOKEN: TOKEN, WOMBAT_PORT: "14900", ANTHROPIC_API_KEY: API_KEY }));
  });

  test.each(harnesses.map((harness) => [harness.id, harness] as const))(
    "harness %s spawns without secrets from a polluted source",
    (_id, harness) => {
      expectNoSecrets(harness.spawn(tmpdir(), polluted).env);
    },
  );

  test.each(harnesses.map((harness) => [harness.id, harness] as const))(
    "harness %s spawns without secrets from the service's own environment",
    (_id, harness) => {
      vi.stubEnv("WOMBAT_TOKEN", TOKEN);
      vi.stubEnv("WOMBAT_PORT", "14900");
      vi.stubEnv("ANTHROPIC_API_KEY", API_KEY);
      vi.stubEnv("SERVICE_AUTH", TOKEN);
      expectNoSecrets(harness.spawn(tmpdir()).env);
    },
  );
});
