// The shell state across a quit and a start, against the built app: the page writes it into settings.json through
// main, and the next start reads it back. The service and its agent keep running between the starts (the quit
// answers Keep running). What this check relies on in the page: the open agent's chat is in `main`, its `h2` naming
// the agent; an edit request in the chat is a `region` "Edit approval" with a button "Open side by side" that opens
// its diff tab, titled "notes.txt (diff)", in the one visible `tablist`.
import {
  click,
  expect,
  openAgent,
  REPO,
  sendOpenAgent,
  startAgent,
  startWaitingAgent,
  SWITCH,
  tabTitles,
  test,
  waitForConnection,
  waitUntil,
  WAIT_MS,
} from "./app-fixtures.ts";

const DIFF_TAB = "notes.txt (diff)";

test("after a quit and a start, the agent that was open is open again, with its workspace's tab", async ({ sandbox }) => {
  test.setTimeout(90_000);
  const env = { [SWITCH.quitAnswer]: "leave" };
  await sandbox.startService(sandbox.workspace);
  const agentId = await startWaitingAgent(sandbox, "Update the notes.");

  const first = await sandbox.launch({ env });
  await waitForConnection(first.page, "connected");
  await openAgent(first, agentId);
  await click(first.page.getByRole("main").getByRole("region", { name: "Edit approval" }).last().getByRole("button", { name: "Open side by side" }));
  await expect.poll(() => tabTitles(first.page), { timeout: WAIT_MS }).toEqual([DIFF_TAB]);
  await waitUntil("the open agent and its diff tab in settings.json", WAIT_MS, () => {
    const saved = JSON.stringify(sandbox.readSettings()?.["shell"] ?? null);
    return saved.includes(agentId) && saved.includes('"diff"') ? true : undefined;
  });
  await first.quit();
  await first.exited();

  const second = await sandbox.launch({ env });
  await waitForConnection(second.page, "connected");
  await expect(second.page.getByRole("main").getByRole("heading", { level: 2 }), "the agent isn't open again").toHaveText([REPO], { timeout: WAIT_MS });
  await expect.poll(() => tabTitles(second.page), { message: "the diff tab isn't back", timeout: WAIT_MS }).toEqual([DIFF_TAB]);
});

test("a notification click that arrives before the saved shell is restored opens its agent, not the saved one", async ({ sandbox }) => {
  test.setTimeout(90_000);
  const env = { [SWITCH.quitAnswer]: "leave" };
  // Both agents are titled by their repo; their prompts tell their chats apart.
  const CLICKED_PROMPT = "Water the basil.";
  await sandbox.startService(sandbox.workspace);
  const savedId = await startWaitingAgent(sandbox, "Update the notes.");
  const clickedId = await startAgent(sandbox, "fake-reply");
  const sent = await sandbox.api("POST", `/agents/${clickedId}/messages`, { text: CLICKED_PROMPT });
  expect(sent.status, `prompt: ${JSON.stringify(sent.json)}`).toBe(202);
  const openAgentSaved = (): unknown => (sandbox.readSettings()?.["shell"] as { openAgent?: unknown } | undefined)?.openAgent;

  const first = await sandbox.launch({ env });
  await waitForConnection(first.page, "connected");
  await openAgent(first, savedId);
  await waitUntil("the open agent in settings.json", WAIT_MS, () => (openAgentSaved() === savedId ? true : undefined));
  await first.quit();
  await first.exited();

  // Sent as soon as the window exists: before the page has subscribed, so before the restore.
  const second = await sandbox.launch({ env, onWindow: (app) => sendOpenAgent(app, clickedId) });
  await waitForConnection(second.page, "connected");
  // The shell saved after the start names the clicked agent: the restore didn't put the saved one back over it.
  await waitUntil("the clicked agent to be the open agent in settings.json", WAIT_MS, () => (openAgentSaved() === clickedId ? true : undefined));
  const main = second.page.getByRole("main");
  await expect(main.getByText(CLICKED_PROMPT), "the clicked agent's chat isn't in the middle").toBeVisible({ timeout: WAIT_MS });
  await expect(main.getByRole("region", { name: "Edit approval" }), "the saved agent's chat is in the middle").toHaveCount(0);
});
