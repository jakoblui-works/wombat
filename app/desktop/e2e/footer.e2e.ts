// Lasting check "Config options round-trip", the desktop half (T6): the composer footer shows the options the agent
// uses, as the log says, never a value it picked locally. Against the built app and the fake agent (app-fixtures.ts),
// which offers a select "Model" (Fake small, Refuse large) and a boolean "Fast mode", and refuses "Refuse large".
// What this check relies on in the page (roles and names, not looks; interface-S2 "T6: composer footer"):
// - the footer sits in the agent's chat (the editor group with its tab, agent-views.ts `groupWithTab`);
// - a select option is a `combobox` named by the option's `name`, showing the current value's name; its values are
//   `option`s (in a popup, anywhere on the page) named by their names;
// - a boolean option is a `switch` named by the option's `name`, checked when on.
import type { Page } from "@playwright/test";

import { FAKE_CONFIG, fakeConfigOptions } from "../../service/test/fake-agent.ts";
import { click, expect, openAgent, REPO, startAgent, test, waitForConnection, waitUntil, WAIT_MS, type Sandbox } from "./app-fixtures.ts";
import { groupWithTab } from "./agent-views.ts";

type Option = { id: string; currentValue?: unknown };
type Entry = { type: string; update?: { sessionUpdate?: string; configOptions?: Option[] } };

const [MODEL, FAST] = fakeConfigOptions({ model: FAKE_CONFIG.model.initial, fast: FAKE_CONFIG.fast.initial });
const optionName = (value: string): string => {
  const option = MODEL?.type === "select" ? MODEL.options.find((candidate) => "value" in candidate && candidate.value === value) : undefined;
  return option && "name" in option ? option.name : value;
};
const REFUSED = FAKE_CONFIG.model.values.find((value) => value.startsWith("refuse")) ?? "";

/** The current values in the service's log (its latest config_option_update), by option id. */
const loggedConfig = async (sandbox: Sandbox, agentId: string): Promise<Record<string, unknown>> => {
  const { json } = await sandbox.api("GET", `/agents/${agentId}/log`);
  const entries = ((json as { entries?: Entry[] }).entries ?? []).filter((entry) => entry.update?.sessionUpdate === "config_option_update");
  return Object.fromEntries((entries.at(-1)?.update?.configOptions ?? []).map((option) => [option.id, option.currentValue]));
};

const setFromElsewhere = async (sandbox: Sandbox, agentId: string, configId: string, value: string | boolean): Promise<void> => {
  const response = await sandbox.api("POST", `/agents/${agentId}/config`, { configId, value });
  expect(response.status, `set ${configId}=${String(value)} through the api`).toBe(204);
};

const pick = async (page: Page, combobox: ReturnType<Page["getByRole"]>, name: string): Promise<void> => {
  await click(combobox);
  await click(page.getByRole("option", { name, exact: true }));
};

test.describe("composer footer", () => {
  test("footer: a change made in the footer reaches the agent, one made elsewhere shows in it, and a refused one never sticks", async ({ sandbox }) => {
    test.setTimeout(90_000);
    await sandbox.startService(sandbox.workspace);
    const agentId = await startAgent(sandbox, "fake-reply");
    const launched = await sandbox.launch();
    const { page } = launched;
    await waitForConnection(page, "connected");
    await openAgent(launched, agentId, 1);
    const chat = groupWithTab(page, REPO);

    const model = chat.getByRole("combobox", { name: MODEL?.name ?? "", exact: true });
    const fast = chat.getByRole("switch", { name: FAST?.name ?? "", exact: true });
    await expect(model, "the session's model").toContainText(optionName(FAKE_CONFIG.model.initial), { timeout: WAIT_MS });
    await expect(fast, "the session's fast mode").not.toBeChecked();

    // From the footer to the agent: the log holds the agent's answer.
    await click(fast);
    await waitUntil("the agent's answer with fast mode on, in the log", WAIT_MS, async () => ((await loggedConfig(sandbox, agentId))[FAST?.id ?? ""] === true ? true : undefined));
    await expect(fast).toBeChecked({ timeout: WAIT_MS });

    // From elsewhere to the footer: what it shows is the log's, not what it last sent.
    await setFromElsewhere(sandbox, agentId, FAST?.id ?? "", false);
    await expect(fast, "a change made through the api").not.toBeChecked({ timeout: WAIT_MS });

    // A value the agent refuses: once a later set has gone through, the footer still shows the model in use.
    await pick(page, model, optionName(REFUSED));
    await setFromElsewhere(sandbox, agentId, FAST?.id ?? "", true);
    await expect(fast, "the later set").toBeChecked({ timeout: WAIT_MS });
    expect((await loggedConfig(sandbox, agentId))[MODEL?.id ?? ""], "the agent's model").toBe(FAKE_CONFIG.model.initial);
    await expect(model, "the model the agent still uses").toContainText(optionName(FAKE_CONFIG.model.initial), { timeout: WAIT_MS });
    await expect(model).not.toContainText(optionName(REFUSED));
  });
});
