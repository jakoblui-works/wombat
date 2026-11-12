// End-to-end check (S2c, T15, row T15-4; slow suite): typing `/context` to an agent whose harness offers the
// breakdown opens the context dialog with the agent's categories, clears the message box, and leaves no trace: the
// agent's log and state are as they were. Against the built app and the fake agent (app-fixtures.ts), whose harness
// offers the breakdown and answers FAKE_BREAKDOWN (service/test/fake-agent.ts).
// What this check relies on in the page (roles and names, not looks): the message box is the textbox "Message";
// the context dialog is a modal `dialog` that Escape closes (the box is checked once it has, since a modal dialog hides
// the page behind it from roles); the default dialog lists the used, buffer and free categories and each list's title
// by name (deferred rows are left out).
import { FAKE_BREAKDOWN } from "../../service/test/fake-agent.ts";
import { agentSummary, expect, openAgent, REPO, startAgent, test, waitForConnection, WAIT_MS } from "./app-fixtures.ts";
import { groupWithTab, logOf, waitForState } from "./agent-views.ts";

test.describe("/context", () => {
  test("context: /context opens the breakdown dialog, clears the box, and the agent's log gains no entry", async ({ sandbox }) => {
    test.setTimeout(90_000);
    await sandbox.startService(sandbox.workspace);
    const agentId = await startAgent(sandbox, "fake-reply");
    await waitForState(sandbox, agentId, "done");
    const launched = await sandbox.launch();
    const { page } = launched;
    await waitForConnection(page, "connected");
    await openAgent(launched, agentId, 1);
    const chat = groupWithTab(page, REPO);

    const entries = await logOf(sandbox, agentId);
    const before = await agentSummary(sandbox, agentId);

    const box = chat.getByRole("textbox", { name: "Message", exact: true });
    await box.fill("/context");
    await box.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: WAIT_MS });
    for (const category of FAKE_BREAKDOWN.categories.filter(({ kind }) => kind !== "deferred")) {
      await expect(dialog.getByText(category.name, { exact: true }).first(), `category ${category.name}`).toBeVisible({ timeout: WAIT_MS });
    }
    for (const list of FAKE_BREAKDOWN.lists) await expect(dialog.getByText(list.title, { exact: true }).first()).toBeVisible();
    // The dialog is modal: the page behind it is hidden from the accessibility tree until it closes.
    await page.keyboard.press("Escape");
    await expect(dialog, "the dialog closes on Escape").toBeHidden({ timeout: WAIT_MS });
    await expect(box, "the command isn't left in the box").toHaveValue("");

    expect((await logOf(sandbox, agentId)).length, "no entry in the agent's log").toBe(entries.length);
    expect(await agentSummary(sandbox, agentId), "the agent's state, text and title as they were").toEqual(before);
  });
});
