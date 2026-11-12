// manager.setConfig refuses what the agent's latest stored options don't take, before asking the agent: an unknown
// agent, one without a process, an unknown option, a value the option doesn't offer, or one of the wrong type. A
// refused set stores nothing. The agent's own refusal (agent_error) is config-options.test.ts's.
import type { LogEntry } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { FAKE_CONFIG } from "../../test/fake-agent.ts";
import { REPO, setup, TEST_TIMEOUT_MS, type Setup } from "../../test/manager-fixtures.ts";

const configEntries = (t: Setup, agentId: string) =>
  t.entries(agentId).filter((entry: LogEntry) => entry.type === "session_update" && entry.update.sessionUpdate === "config_option_update").length;

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );

test("an unknown agent is not_found", async () => {
  const t = setup();
  expect(await refusal(t.manager.setConfig("no-such-agent", FAKE_CONFIG.model.id, "fake-small"))).toMatchObject({ code: "not_found" });
});

test(
  "an agent whose process ended is not_running",
  async () => {
    const t = setup();
    const { id } = await t.manager.start("fake-reply", REPO);
    await t.manager.stop(id);
    expect(await refusal(t.manager.setConfig(id, FAKE_CONFIG.model.id, "fake-small"))).toMatchObject({ code: "not_running" });
  },
  TEST_TIMEOUT_MS,
);

test.each<[string, string, string | boolean]>([
  ["an unknown option", "no-such-option", "fake-small"],
  ["a value the select doesn't offer", FAKE_CONFIG.model.id, "huge-model"],
  ["a boolean to a select", FAKE_CONFIG.model.id, true],
  ["a string to a boolean", FAKE_CONFIG.fast.id, "true"],
])(
  "%s is invalid_request, and nothing is stored",
  async (_name, configId, value) => {
    const t = setup();
    const { id } = await t.manager.start("fake-reply", REPO);
    const before = configEntries(t, id);
    expect(await refusal(t.manager.setConfig(id, configId, value))).toMatchObject({ code: "invalid_request" });
    expect(configEntries(t, id)).toBe(before);
  },
  TEST_TIMEOUT_MS,
);
