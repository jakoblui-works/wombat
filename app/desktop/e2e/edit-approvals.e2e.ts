// Edit approvals, against the built app and the fake-permission agent (an edit of notes.txt, one line
// changed). What this check relies on in the page (roles and names, not looks; the approved design's structure):
// - an edit request in the chat is a `region` "Edit approval" with the file's name, its +/− counts, a button
//   "Open side by side", and while open the buttons "Approve" and "Reject";
// - the diff tab is titled "notes.txt (diff)" and has the same "Approve" and "Reject" while open;
// - an answered request says "approved" or "rejected" (any case), in the chat and in its diff tab;
// - the diff tab shows Monaco's diff editor (`.monaco-diff-editor`).
// It is also the one check that Monaco runs under the page's CSP: Monaco loads lazily with the first diff tab, so
// no other test mounts it. While it's mounted, no CSP violation and no page error may happen.
import type { Page } from "@playwright/test";

import { click, expect, layoutOf, openAgent, REPO, type Sandbox, startWaitingAgent, SWITCH, tabCount, test, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";
import { answersIn, groupWithTab, logOf, prompt, waitForState } from "./agent-views.ts";

const DIFF_TAB = "notes.txt (diff)";

// Records CSP violations in the page from now on (the page is loaded; Monaco isn't yet).
const VIOLATIONS = "__wombatE2eCspViolations";
const recordViolations = (page: Page): Promise<void> =>
  page.evaluate((key) => {
    const seen: string[] = [];
    (window as unknown as Record<string, unknown>)[key] = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} blocked ${event.blockedURI || "(inline)"} at ${event.sourceFile}:${String(event.lineNumber)}`);
    });
  }, VIOLATIONS);
const violations = (page: Page): Promise<string[]> =>
  page.evaluate((key) => [...((window as unknown as Record<string, string[] | undefined>)[key] ?? ["(recorder missing)"])], VIOLATIONS);

const savedLayoutText = (sandbox: Sandbox): string =>
  JSON.stringify((sandbox.readSettings()?.["workspaces"] as Record<string, { layout?: unknown }> | undefined)?.[sandbox.workspace]?.layout ?? null);

test.describe("edit approvals", () => {
  test("approve from the diff tab and the chat shows approved; reject inline and the tab shows rejected; answered diff tabs aren't restored", async ({ sandbox }) => {
    test.setTimeout(120_000);
    const env = { [SWITCH.quitAnswer]: "leave" };
    await sandbox.startService(sandbox.workspace);
    const agentId = await startWaitingAgent(sandbox, "Update the notes.");
    const launched = await sandbox.launch({ env });
    const { page } = launched;
    await waitForConnection(page, "connected");
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await recordViolations(page);
    await openAgent(launched, agentId, 1);
    const chat = groupWithTab(page, REPO);

    // The inline card: the file, one line removed and one added.
    const card = chat.getByRole("region", { name: "Edit approval" }).last();
    await expect(card).toBeVisible({ timeout: WAIT_MS });
    await expect(card).toContainText("notes.txt");
    await expect(card).toContainText(/\+\s*1/);
    await expect(card).toContainText(/[−-]\s*1/);

    // Open side by side: the diff tab in a group to the right of the chat's.
    await click(card.getByRole("button", { name: "Open side by side" }));
    await waitUntil("the diff tab beside the chat", WAIT_MS, async () => {
      const groups = await layoutOf(page);
      return groups.length === 2 && groups[0]?.tabs.includes(REPO) && groups[1]?.tabs.includes(DIFF_TAB) ? true : undefined;
    });
    const diff = groupWithTab(page, DIFF_TAB);
    await expect(diff).toContainText("new line", { timeout: WAIT_MS });

    // Monaco is mounted, under the CSP, without a violation or a page error (its <style>s carry the page's nonce,
    // its worker is same-origin). Let its queued work run first.
    await expect(diff.locator(".monaco-diff-editor")).toHaveCount(1);
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 0), 50)));
    expect(await violations(page), "CSP violations with Monaco mounted").toEqual([]);
    expect(pageErrors, "page errors with Monaco mounted").toEqual([]);

    // Approve in the diff tab: the agent gets the allow; the chat and the tab both say approved; the tab stays.
    await click(diff.getByRole("button", { name: "Approve", exact: true }));
    await waitForState(sandbox, agentId, "done");
    expect(answersIn(await logOf(sandbox, agentId))).toEqual(["allow_once"]);
    await expect(chat.getByText(/approved/i).first()).toBeVisible({ timeout: WAIT_MS });
    await expect(diff.getByText(/approved/i).first()).toBeVisible();
    await expect(diff.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

    // A second request: its diff tab opened, then rejected inline; the tab says rejected.
    await prompt(sandbox, agentId, "Now the other line.");
    await waitForState(sandbox, agentId, "waiting");
    const tabsBefore = await tabCount(page);
    await click(chat.getByRole("region", { name: "Edit approval" }).last().getByRole("button", { name: "Open side by side" }));
    await waitUntil("the second diff tab", WAIT_MS, async () => ((await tabCount(page)) > tabsBefore ? true : undefined));
    await click(chat.getByRole("button", { name: "Reject", exact: true }));
    await waitForState(sandbox, agentId, "done");
    expect(answersIn(await logOf(sandbox, agentId))).toEqual(["allow_once", "reject_once"]);
    await expect(diff.getByText(/rejected/i).first()).toBeVisible({ timeout: WAIT_MS });
    await expect(diff.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);

    expect(await violations(page), "CSP violations while answering").toEqual([]);
    expect(pageErrors, "page errors while answering").toEqual([]);

    // Restart: the chat comes back, the answered requests' diff tabs don't.
    await waitUntil("the diff tabs in the saved layout", WAIT_MS, () => (savedLayoutText(sandbox).includes('"diff"') ? true : undefined));
    await launched.quit();
    await launched.exited();
    const again = await sandbox.launch({ env, workspaceAnswer: null });
    await waitForConnection(again.page, "connected");
    await waitUntil("the chat tab restored", WAIT_MS, async () => ((await layoutOf(again.page)).some((group) => group.tabs.includes(REPO)) ? true : undefined));
    // Only the chat: a restored diff tab may carry another title until its view has read the request.
    const tabs = (await layoutOf(again.page)).flatMap((group) => group.tabs);
    expect(tabs, "an answered request's diff tab was restored").toEqual([REPO]);
  });
});
