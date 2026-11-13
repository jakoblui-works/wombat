// A
// set through POST /agents/:id/config reaches the agent, and the agent's answer is what `configOf` reads from the
// log, so the footer never shows a value the agent isn't using. Against the fake ACP agent, which offers a select
// `model` (fake-small, refuse-large) and a boolean `fast`, refuses any `refuse…` value, refuses a set whose wire shape
// isn't ACP v1's (a boolean needs `type: "boolean"`, a select's value goes bare), and answers with its own new list.
// The error cases the route shares with the other agent routes (not_found, not_running, invalid_request) are the
// builder's tests.
import type { LogEntry } from "@wombat/shared/api";
import { configOf, foldLog } from "@wombat/shared/log-fold";
import { expect, test } from "vitest";

import { CONFIG_REFUSAL_MESSAGE, FAKE_CONFIG, fakeConfigOptions, type ReplayStep } from "../../test/fake-agent.ts";
import { REPO, TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";
import { expectError, serve, type Served } from "../../test/server-fixtures.ts";

const INITIAL = { model: FAKE_CONFIG.model.initial, fast: FAKE_CONFIG.fast.initial };

/** What the footer reads: configOf over the chat's fold of the stored log. */
const configNow = (s: Served, agentId: string) => configOf(foldLog(s.entries(agentId), s.agent(agentId)?.sessionId));

const configEntries = (s: Served, agentId: string) =>
  s.entries(agentId).filter((entry: LogEntry) => entry.type === "session_update" && entry.update.sessionUpdate === "config_option_update").length;

const startAgent = async (s: Served, harness: string): Promise<string> => {
  const started = await s.api("POST", "/agents", { harness, repo: REPO });
  expect(started.status, started.text).toBe(201);
  const agentId = (started.json as { id: string }).id;
  await waitFor("the session's options in the log", () => configNow(s, agentId) !== undefined);
  return agentId;
};

const setConfig = (s: Served, agentId: string, configId: string, value: string | boolean) => s.api("POST", `/agents/${agentId}/config`, { configId, value });

test(
  "the session's options are in the log from the start, and each set's answer is in the log by the time the route answers",
  async () => {
    const s = await serve();
    const id = await startAgent(s, "fake-reply");
    expect(configNow(s, id), "before any set").toEqual(fakeConfigOptions(INITIAL));
    expect(configEntries(s, id), "one entry for the session's options").toBe(1);

    // A boolean, both ways: the fake refuses one sent without `type: "boolean"`.
    for (const fast of [true, false]) {
      const response = await setConfig(s, id, FAKE_CONFIG.fast.id, fast);
      expect(response.status, `fast=${String(fast)}: ${response.text}`).toBe(204);
      // Read at once, no polling: the route answers once the entry is stored.
      expect(configNow(s, id), `after fast=${String(fast)}`).toEqual(fakeConfigOptions({ ...INITIAL, fast }));
    }

    // A select value: the fake refuses one sent with a type. Its answer comes back as a new entry.
    await setConfig(s, id, FAKE_CONFIG.fast.id, true);
    const before = configEntries(s, id);
    const response = await setConfig(s, id, FAKE_CONFIG.model.id, "fake-small");
    expect(response.status, response.text).toBe(204);
    expect(configEntries(s, id), "the agent's answer stored as a new entry").toBe(before + 1);
    expect(configNow(s, id), "after model=fake-small, fast still on in the agent").toEqual(fakeConfigOptions({ model: "fake-small", fast: true }));
  },
  TEST_TIMEOUT_MS,
);

test(
  "a value the agent refuses answers agent_error (502) with the agent's message, and leaves the log's options as they were",
  async () => {
    const s = await serve();
    const id = await startAgent(s, "fake-reply");
    expect((await setConfig(s, id, FAKE_CONFIG.fast.id, true)).status).toBe(204);
    const options = configNow(s, id);
    const entries = configEntries(s, id);

    const refused = FAKE_CONFIG.model.values.find((value) => value.startsWith("refuse")) ?? "";
    const response = await setConfig(s, id, FAKE_CONFIG.model.id, refused);
    expectError(response, 502, "agent_error", `model=${refused}`);
    expect((response.json as { error: { message: string } }).error.message, "the agent's message, for the app").toContain(CONFIG_REFUSAL_MESSAGE);
    expect(configEntries(s, id), "no entry for a refused set").toBe(entries);
    expect(configNow(s, id), "the options the agent still uses").toEqual(options);
  },
  TEST_TIMEOUT_MS,
);

test(
  "options the agent changes on its own, in a session update, are what configOf reads",
  async () => {
    const s = await serve();
    const id = await startAgent(s, "fake-replay");
    const changed = fakeConfigOptions({ model: "refuse-large", fast: true });
    const replay: ReplayStep[] = [{ send: { sessionUpdate: "config_option_update", configOptions: changed } }];
    const sent = await s.api("POST", `/agents/${id}/messages`, { text: JSON.stringify(replay) });
    expect(sent.status, sent.text).toBeLessThan(300);
    await s.turnEnded(id);
    expect(configNow(s, id)).toEqual(changed);
  },
  TEST_TIMEOUT_MS,
);
