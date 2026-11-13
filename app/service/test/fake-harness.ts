import { fileURLToPath } from "node:url";

import type { ContextBreakdown } from "@wombat/shared/api";

import { agentEnv } from "../src/harness/env.ts";
import type { CacheState, Harness } from "../src/harness/harness.ts";
import { FAKE_EXT, type FakeScenario } from "./fake-agent.ts";

const FAKE_AGENT = fileURLToPath(new URL("fake-agent.ts", import.meta.url));

/** How long the fake harness waits for the fake agent's context report, unless `contextTimeoutMs` says otherwise. */
const CONTEXT_TIMEOUT_MS = 5_000;

export type FakeHarnessOptions = {
  /** How long `contextBreakdown` waits for the report before it gives up (default CONTEXT_TIMEOUT_MS). */
  contextTimeoutMs?: number;
  /** Whether the harness says its agents can be resumed (default true, as the fake agent can); false for D28. */
  resume?: boolean;
};

/**
 * A harness on the scripted fake ACP agent, for tests; never registered. It offers both optional parts the way a
 * real harness would: `contextBreakdown` prompts `/context` and returns the report the agent sends as FAKE_EXT.context
 * (FAKE_BREAKDOWN), and `extNotification` reports the cache state a `cache` replay step sends as FAKE_EXT.cache.
 * It is `resumable` (S2d) unless `resume: false`.
 */
export const fakeHarness = (
  scenario: FakeScenario,
  { contextTimeoutMs = CONTEXT_TIMEOUT_MS, resume = true }: FakeHarnessOptions = {},
): Harness => {
  const base: Harness = {
    id: "fake",
    name: "Fake agent",
    loginHint: "The fake agent needs no login.",
    spawn: (cwd, source = process.env) => ({
      command: process.execPath,
      args: [FAKE_AGENT, scenario],
      cwd,
      env: agentEnv(source),
    }),
    extNotification: (method, params) =>
      method === FAKE_EXT.cache ? { cache: (params as { cache: CacheState | null }).cache } : undefined,
    ...(resume ? { resumable: true } : {}),
  };
  return {
    ...base,
    contextCommand: "context",
    contextBreakdown: async ({ prompt, nextExt }) => {
      // Waiting before prompting: the report arrives before the prompt's answer. Whichever fails first is the answer:
      // a failed prompt never sends the report, and a report that never comes is given up on while the prompt may
      // still be open (the manager then cancels it).
      const report = nextExt(FAKE_EXT.context, () => true, contextTimeoutMs);
      const [params] = await Promise.all([report, prompt("/context")]);
      return (params as { breakdown: ContextBreakdown }).breakdown;
    },
  };
};
