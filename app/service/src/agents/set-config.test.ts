// manager.setConfig refuses what the agent's latest stored options don't take, before asking the agent: an unknown
// agent, one without a process, an unknown option, a value the option doesn't offer, or one of the wrong type. A
// refused set stores nothing. The agent's own refusal (agent_error) is config-options.test.ts's.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { LogEntry } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { FAKE_CONFIG, type FakeConfig } from "../../test/fake-agent.ts";
import { NO_RESUME_HARNESS, REPO, setup, TEST_TIMEOUT_MS, type Setup } from "../../test/manager-fixtures.ts";

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
  // S2d, D26: a resumable harness's stopped agent is started by the set instead (the builder's row T19-8).
  "an agent whose process ended and whose harness can't resume is not_running",
  async () => {
    const t = setup();
    const { id } = await t.manager.start(NO_RESUME_HARNESS, REPO);
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

// S2d, T19 (row T19-4): claude-agent-acp answers session/resume with model and effort at their defaults, and the next
// prompt runs on them; the service sets the stored values again. Without that the agent quietly changes model. The
// fake agent does the same (every option back at its initial value), and its mcp-config scenario reports the values
// its session holds while it runs the prompt.
test(
  "T19-4: after a resume, the agent runs on the model, effort, mode and fast mode it had, not on the defaults its resume answered",
  async () => {
    const t = setup();
    const { id } = await t.manager.start("fake-mcp-config", REPO);
    const chosen: FakeConfig = { model: "fake-large", fast: true, effort: "high", mode: "plan" };
    for (const [configId, value] of Object.entries(chosen)) await t.manager.setConfig(id, configId, value);
    await t.manager.stop(id);

    const report = join(dirname(t.root), "resumed-config.json");
    await t.manager.send(id, { text: report });
    await t.turnEnded(id);

    const reported = JSON.parse(readFileSync(report, "utf8")) as { sessionResume?: unknown; config?: FakeConfig };
    expect(reported.sessionResume, "the agent was resumed, not started anew").toBeDefined();
    expect(reported.config, "the values the agent ran the prompt on").toEqual(chosen);
    const options = t.entries(id).flatMap((entry) =>
      entry.type === "session_update" && entry.update.sessionUpdate === "config_option_update" ? [entry.update.configOptions] : [],
    );
    const latest = Object.fromEntries((options.at(-1) ?? []).map((option) => [option.id, option.currentValue]));
    expect(latest, "what the log, and so the footer, says the agent uses").toEqual(chosen);
  },
  TEST_TIMEOUT_MS,
);
