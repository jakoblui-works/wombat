// S7 T13: the chat, against the built app and the fake agents (app-fixtures.ts).
// What these checks rely on in the page (roles and names, not looks; the approved design's structure):
// - a chat tab's content is the active panel of its editor group (agent-views.ts `groupWithTab`);
// - collapsed parts (reasoning, a tool call) are buttons with `aria-expanded="false"`; expanding shows their text (a
//   tool call's text content through Markdown, the same rules as agent text);
// - a clipped text says how many characters were left out, in digits (group separators allowed);
// - an open permission has the buttons "Approve" and "Reject" (permissionButtons) and, once answered, says
//   "approved" or "rejected" (any case) and has no answer buttons.
import type { Page } from "@playwright/test";

import { HOSTILE } from "../../service/test/fake-agent.ts";
import { MAX_SHOWN_CHARS } from "../src/renderer/src/workbench/views/Chat/clip-text.ts";
import { agentSummary, expect, openAgent, REPO, startAgent, startWaitingAgent, SWITCH, test, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";
import { answersIn, groupWithTab, logOf, prompt } from "./agent-views.ts";

const marker = (page: Page): Promise<unknown> => page.evaluate((name) => (window as unknown as Record<string, unknown>)[name], HOSTILE.marker);

/** Expands every collapsed part of `root` (reasoning, tool calls), however deep, a bounded number of rounds. */
const expandAll = async (root: ReturnType<typeof groupWithTab>): Promise<void> => {
  const collapsed = root.locator('[aria-expanded="false"]');
  for (let round = 0; round < 10 && (await collapsed.count()) > 0; round += 1) await collapsed.first().click();
  await expect(collapsed, "parts of the chat stay collapsed").toHaveCount(0);
};

/**
 * What in the React root could run, load or navigate: offending elements and attributes, described. The one image
 * the app shows of its own is exempt, and only that one: the logo in the title bar (the page's top-level <header>,
 * outside every sidebar, editor group and dialog, where no agent content goes), with an empty alt and a same-origin
 * src. Agent images render as their alt text, so any other <img> anywhere is agent content loading something.
 */
const activeContent = (page: Page): Promise<string[]> =>
  page.evaluate((hostileMarker) => {
    const found: string[] = [];
    const root = document.getElementById("root");
    if (root === null) return ["no #root"];
    const titleBar = [...root.querySelectorAll("header")].find((header) => header.closest("aside, .dv-groupview, [role='dialog'], [role='alertdialog']") === null);
    const titleImages = titleBar === undefined ? [] : [...titleBar.querySelectorAll("img")];
    const appLogo =
      titleImages.length === 1 && titleImages[0]?.getAttribute("alt") === "" && new URL(titleImages[0].src).origin === location.origin ? titleImages[0] : undefined;
    const banned = new Set(["SCRIPT", "IFRAME", "FRAME", "OBJECT", "EMBED", "IMG", "VIDEO", "AUDIO", "SOURCE", "FORM", "BASE", "META", "LINK"]);
    for (const element of root.querySelectorAll("*")) {
      if (element === appLogo) continue;
      if (banned.has(element.tagName.toUpperCase())) found.push(`<${element.tagName.toLowerCase()}>`);
      if (element.tagName.toUpperCase() === "STYLE" && /__wombatHostile|example\.invalid/.test(element.textContent ?? "")) found.push("<style> with agent content");
      for (const { name, value } of element.attributes) {
        const lower = name.toLowerCase();
        if (lower.startsWith("on")) found.push(`${lower} on <${element.tagName.toLowerCase()}>`);
        if (["src", "srcset", "srcdoc", "action", "formaction", "poster", "background"].includes(lower)) found.push(`${lower} on <${element.tagName.toLowerCase()}>`);
        if (lower === "href" && !/^https:\/\//.test(value)) found.push(`href="${value}" on <${element.tagName.toLowerCase()}>`);
        if (lower === "style" && value.includes(hostileMarker)) found.push(`style with agent content on <${element.tagName.toLowerCase()}>`);
      }
    }
    return found;
  }, HOSTILE.marker);

test.describe("T13: chat", () => {
  test("agent content stays inert: HTML, scripts and non-https links in every part of the chat render as text; a huge output is clipped", async ({ sandbox }) => {
    test.setTimeout(90_000);
    expect(HOSTILE.hugeChars, "the fake's huge output must exceed what the chat shows").toBeGreaterThan(MAX_SHOWN_CHARS * 2);
    await sandbox.startService(sandbox.workspace);
    const agentId = await startAgent(sandbox, "fake-hostile");
    await prompt(sandbox, agentId, "Show me everything.");
    await waitUntil("the hostile agent to wait on its permission", WAIT_MS, async () => ((await agentSummary(sandbox, agentId))?.state === "waiting" ? true : undefined));

    const launched = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
    const { page, app } = launched;
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) problems.push(`console: ${message.text()}`);
    });
    await waitForConnection(page, "connected");
    const startUrl = page.url();
    await openAgent(launched, agentId, 1);
    const chat = groupWithTab(page, REPO);
    await expect(chat.getByText("Hostile message starts.")).toBeVisible({ timeout: WAIT_MS });
    await expandAll(chat);

    // Everything is there to read, as text.
    const text = await chat.innerText();
    for (const where of ["message", "reasoning", "tool content"]) {
      expect(text, `the ${where}'s markdown`).toContain(`Hostile ${where} starts.`);
      expect(text, `the ${where}'s raw script`).toContain(`<script>window.__wombatHostile = "${where}: script"</script>`);
      for (const label of ["javascript link", "data link", "file link", "relative link", "app link", "reference link", "html link", "image alt", "safe link"]) {
        expect(text, `"${label} ${where}"`).toContain(`${label} ${where}`);
      }
    }
    for (const where of ["plan entry", "tool title", "tool input", "tool output", "permission title"]) {
      expect(text, `the ${where} as text`).toContain(`<b>${where}</b>`);
    }

    // Nothing runs, loads or links anywhere but https: in the whole page (the sidebar's excerpt included).
    expect(await activeContent(page)).toEqual([]);
    expect(await marker(page)).toBeUndefined();

    // The huge output: clipped, saying how much was left out.
    const hugeLines = text.split("huge output line").length - 1;
    expect(hugeLines, "the huge output isn't shown at all").toBeGreaterThan(0);
    expect(hugeLines, "the huge output is shown past MAX_SHOWN_CHARS").toBeLessThanOrEqual(Math.ceil(MAX_SHOWN_CHARS / "huge output line 0123456789\n".length) + 1);
    // Digits, with group separators allowed ("380,000", "380 000", "380.000").
    const numbers = (text.match(/\d{1,3}(?:[,.\u00a0\u202f ]\d{3})+(?!\d)|\d+/g) ?? []).map((n) => Number(n.replace(/\D/g, "")));
    expect(
      numbers.some((n) => n >= HOSTILE.hugeChars - MAX_SHOWN_CHARS && n <= HOSTILE.hugeChars * 2),
      "no line says how many characters of the huge output were left out",
    ).toBe(true);

    // Clicking what would have been links goes nowhere.
    for (const label of ["javascript link", "data link", "file link", "relative link", "app link", "reference link", "html link"]) {
      await chat.getByText(`${label} message`).first().click();
    }
    await expect.poll(() => page.url()).toBe(startUrl);
    expect(app.windows()).toHaveLength(1);
    expect(await marker(page)).toBeUndefined();
    expect(problems).toEqual([]);
  });

  test("answer a permission inline: the agent gets the allow and continues to the end of its turn", async ({ sandbox }) => {
    test.setTimeout(60_000);
    await sandbox.startService(sandbox.workspace);
    const agentId = await startWaitingAgent(sandbox, "Update the notes.");
    const launched = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
    const { page } = launched;
    await waitForConnection(page, "connected");
    await openAgent(launched, agentId, 1);
    const chat = groupWithTab(page, REPO);

    await chat.getByRole("button", { name: "Approve", exact: true }).click();

    await waitUntil("the agent to end its turn", WAIT_MS, async () => ((await agentSummary(sandbox, agentId))?.state === "done" ? true : undefined));
    const log = await logOf(sandbox, agentId);
    expect(answersIn(log)).toEqual(["allow_once"]);
    expect(log.some((entry) => entry.update?.sessionUpdate === "tool_call_update" && entry.update.status === "completed")).toBe(true);
    await expect(chat.getByText(/approved/i).first()).toBeVisible({ timeout: WAIT_MS });
    await expect(chat.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await expect(chat.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
  });
});
