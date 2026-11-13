// manager.setConfig refuses what the agent's latest stored options don't take, before asking the agent: an unknown
// agent, one without a process, an unknown option, a value the option doesn't offer, or one of the wrong type. A
// refused set stores nothing; so does one the agent never answers, which fails with agent_error. The agent's own
// refusal (agent_error) is config-options.test.ts's.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect, test } from "vitest";

import { CONFIG_SILENT_FILE, FAKE_CONFIG, type FakeConfig } from "../../test/fake-agent.ts";
import { REPO, setup, TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );

// claude-agent-acp answers session/resume with model and effort at their defaults, and the next
// prompt runs on them; the service sets the stored values again. Without that the agent quietly changes model. The
// fake agent does the same (every option back at its initial value), and its mcp-config scenario reports the values
// its session holds while it runs the prompt.
test(
  "after a resume, the agent runs on the model, effort, mode and fast mode it had, not on the defaults its resume answered",
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

// A set the agent never answers must end in an error the footer can show, not leave the change pending for good, and
// must not hold up the agent's next message.
test(
  "a setting change the agent never answers fails with agent_error, and the agent then takes a following message",
  async () => {
    const t = setup({ configSetTimeoutMs: 300 });
    const { id } = await t.manager.start("fake-reply", REPO);
    writeFileSync(join(t.root, REPO, CONFIG_SILENT_FILE), "");

    expect(await refusal(t.manager.setConfig(id, FAKE_CONFIG.model.id, "fake-large"))).toMatchObject({ code: "agent_error" });

    await t.manager.send(id, { text: "Still there?" });
    expect((await t.turnEnded(id)).stopReason).toBe("end_turn");
  },
  TEST_TIMEOUT_MS,
);
