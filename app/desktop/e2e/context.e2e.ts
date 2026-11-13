// End-to-end check (S2c, T15, row T15-4; slow suite): typing `/context` to an agent whose harness offers the
// breakdown opens the context dialog with the agent's categories, clears the message box, and leaves no trace: the
// agent's log and state are as they were. Against the built app and the fake agent (app-fixtures.ts), whose harness
// offers the breakdown and answers FAKE_BREAKDOWN (service/test/fake-agent.ts).
// What this check relies on in the page (roles and names, not looks): the message box is the textbox "Message";
// the context dialog is a modal `dialog` that Escape closes (the box is checked once it has, since a modal dialog hides
// the page behind it from roles); the default dialog lists the used, buffer and free categories and each list's title
// by name (deferred rows are left out).
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { FAKE_BREAKDOWN } from "../../service/test/fake-agent.ts";
import {
  agentSummary,
  expect,
  openAgent,
  releaseServiceCalls,
  REPO,
  serviceCallCount,
  startAgent,
  test,
  waitForConnection,
  waitUntil,
  watchServiceCalls,
  WAIT_MS,
} from "./app-fixtures.ts";
import { groupWithTab, logOf, prompt, requestsIn, waitForState } from "./agent-views.ts";

/** Types `/context` in the chat's message box and presses Enter. */
const typeContext = async (page: Page): Promise<void> => {
  const box = groupWithTab(page, REPO).getByRole("textbox", { name: "Message", exact: true });
  await box.fill("/context");
  await box.press("Enter");
};

/** A category the breakdown shows: once it's visible, the dialog has the breakdown. */
const SHOWN = FAKE_BREAKDOWN.categories.find(({ kind }) => kind === "free")?.name ?? "";

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

  // The dialog asks again by itself once a turn that made it busy ends. It must ask once per turn's end: a change to
  // the agent states or to the summaries the app receives must not make it ask on every busy answer (a flood of
  // /context calls) or while the agent waits on the user (still busy).
  test("context: a busy dialog asks again once when the turn ends, not while the agent waits on the user nor on a repeated busy answer", async ({ sandbox }) => {
    test.setTimeout(90_000);
    await sandbox.startService(sandbox.workspace);
    const started = await sandbox.api("POST", "/agents", { harness: "fake-replay", repo: REPO });
    expect(started.status).toBe(201);
    const agentId = (started.json as { id: string }).id;
    // One turn: working until `asked` exists, then waiting on a permission, then working until `done` exists.
    const [asked, done] = [join(sandbox.base, "release-ask"), join(sandbox.base, "release-done")];
    await prompt(sandbox, agentId, JSON.stringify([{ awaitFile: asked }, { ask: { toolCallId: "edit-1", title: "Edit hours.md", kind: "edit" } }, { awaitAnswers: true }, { awaitFile: done }]));
    await waitForState(sandbox, agentId, "working");
    const launched = await sandbox.launch();
    const { page, app } = launched;
    await waitForConnection(page, "connected");
    await openAgent(launched, agentId, 1);
    await watchServiceCalls(app);
    const asks = () => serviceCallCount(app, "POST", `/agents/${agentId}/context`);

    await typeContext(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: WAIT_MS });
    await waitUntil("the first ask", WAIT_MS, async () => ((await asks()) >= 1 ? true : undefined));

    writeFileSync(asked, "");
    await waitForState(sandbox, agentId, "waiting");
    const [requestId] = requestsIn(await logOf(sandbox, agentId));
    const answered = await sandbox.api("POST", `/agents/${agentId}/permissions/${requestId ?? ""}`, { kind: "allow_once" });
    expect(answered.status).toBe(204);
    await waitForState(sandbox, agentId, "working");
    writeFileSync(done, "");
    await waitForState(sandbox, agentId, "done");

    await expect(dialog.getByText(SHOWN, { exact: true }).first(), "the breakdown, asked for again by itself").toBeVisible({ timeout: WAIT_MS });
    expect(await asks(), "one ask on opening and one when the turn ended").toBe(2);
  });

  // The composer treats `/context` as the app's command even before it knows the agent's tool list: a change to how
  // the list loads, or to the command check, must not send it to the agent as a real turn.
  test("context: /context typed before the agent's tool list has loaded opens the dialog and is never sent as a message", async ({ sandbox }) => {
    test.setTimeout(90_000);
    await sandbox.startService(sandbox.workspace);
    const agentId = await startAgent(sandbox, "fake-reply");
    await waitForState(sandbox, agentId, "done");
    const launched = await sandbox.launch();
    const { page, app } = launched;
    await waitForConnection(page, "connected");
    // The tool list is held from now on; the reload makes the page ask for it again.
    await watchServiceCalls(app, { method: "GET", path: "/harnesses" });
    await page.reload();
    await waitForConnection(page, "connected");
    await openAgent(launched, agentId, 1);

    await typeContext(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog, "the dialog opens while the tool list is unknown").toBeVisible({ timeout: WAIT_MS });
    await releaseServiceCalls(app);
    await expect(dialog.getByText(SHOWN, { exact: true }).first(), "the breakdown, once the list is known").toBeVisible({ timeout: WAIT_MS });

    expect(await serviceCallCount(app, "POST", `/agents/${agentId}/messages`), "nothing sent as a message").toBe(0);
    expect((await logOf(sandbox, agentId)).filter((entry) => entry.type === "user_message"), "no message in the agent's log").toEqual([]);
  });
});
