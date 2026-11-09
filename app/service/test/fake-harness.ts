import { fileURLToPath } from "node:url";

import { agentEnv } from "../src/harness/env.ts";
import type { Harness } from "../src/harness/harness.ts";
import type { FakeScenario } from "./fake-agent.ts";

const FAKE_AGENT = fileURLToPath(new URL("fake-agent.ts", import.meta.url));

/** A harness on the scripted fake ACP agent, for tests; never registered. */
export const fakeHarness = (scenario: FakeScenario): Harness => ({
  id: "fake",
  name: "Fake agent",
  loginHint: "The fake agent needs no login.",
  spawn: (cwd, source = process.env) => ({
    command: process.execPath,
    args: [FAKE_AGENT, scenario],
    cwd,
    env: agentEnv(source),
  }),
});
