// The chat, against the built app and the fake agents (app-fixtures.ts).
// What these checks rely on in the page (roles and names, not looks; the approved design's structure):
// - a chat tab's content is the active panel of its editor group (agent-views.ts `groupWithTab`);
// - collapsed parts (reasoning, a tool call) are buttons with `aria-expanded="false"`; expanding shows their text (a
//   tool call's text content through Markdown, the same rules as agent text);
// - a clipped text says how many characters were left out, in digits (group separators allowed);
// - an open permission has the buttons "Approve" and "Reject" (permissionButtons) and, once answered, says
//   "approved" or "rejected" (any case) and has no answer buttons;
// - (S2d, T19) an agent without a process shows "Not running" in the composer footer, with the tooltip "Your next
//   message starts it again" on hover; the settings button is a `button` named "Settings: …" that opens a `dialog`
//   listing a select's values by name, the current one carrying aria-checked, aria-selected or aria-current "true";
//   the message box is the textbox "Message", and Enter sends.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";

import { FAKE_CONFIG, fakeConfigOptions, HOSTILE } from "../../service/test/fake-agent.ts";
import { MAX_SHOWN_CHARS } from "../src/renderer/src/workbench/views/Chat/clip-text.ts";
import { agentSummary, click, current, expect, layoutOf, openAgent, REPO, type Sandbox, startAgent, startWaitingAgent, SWITCH, tabCount, test, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";
import { answersIn, groupWithTab, logOf, prompt, waitForState } from "./agent-views.ts";

// Main hands https links to the host's browser through `shell.openExternal`; the check records those calls instead
// (as trust-boundary.e2e.ts does), so a test never opens the real browser.
const recordOpenExternal = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { wombatE2eOpenedExternally?: string[] }).wombatE2eOpenedExternally = opened;
    shell.openExternal = (url: string) => {
      opened.push(url);
      return Promise.resolve();
    };
  });
const openedExternally = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => [...((globalThis as { wombatE2eOpenedExternally?: string[] }).wombatE2eOpenedExternally ?? ["(recorder missing)"])]);

const marker = (page: Page): Promise<unknown> => page.evaluate((name) => (window as unknown as Record<string, unknown>)[name], HOSTILE.marker);

/** Expands every collapsed part of `root` (reasoning, tool calls), however deep, a bounded number of rounds. */
const expandAll = async (root: ReturnType<typeof groupWithTab>): Promise<void> => {
  const collapsed = root.getByRole("log", { name: "Conversation" }).locator('[aria-expanded="false"]');
  for (let round = 0; round < 10 && (await collapsed.count()) > 0; round += 1) await click(collapsed.first());
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

type Motion = { what: string; text: string; moves: boolean };
type MotionWindow = { e2eMotion: { what: string; target?: Element; moves: boolean }[] };

/**
 * Records, from now on, every CSS animation that starts (and whether it moves: a duration above zero) and every view
 * transition (whether any of its `::view-transition` pseudo-elements moves). The reduced-motion reset leaves
 * animations running at zero duration, so "moves" is what tells motion on from off.
 */
const recordMotion = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const seen: MotionWindow["e2eMotion"] = [];
    (window as unknown as MotionWindow).e2eMotion = seen;
    const longest = (durations: string): number => Math.max(...durations.split(",").map((value) => parseFloat(value)));
    document.addEventListener(
      "animationstart",
      (event) => {
        const target = event.target as Element;
        seen.push({ what: "animation", target, moves: longest(getComputedStyle(target, event.pseudoElement || null).animationDuration) > 0 });
      },
      true,
    );
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = ((update?: ViewTransitionUpdateCallback | StartViewTransitionOptions) => {
      const transition = start(update as ViewTransitionUpdateCallback);
      transition.ready.then(
        () => {
          const pseudo = document.getAnimations().filter((animation) => ((animation.effect as KeyframeEffect | null)?.pseudoElement ?? "").startsWith("::view-transition"));
          seen.push({ what: "view transition", moves: pseudo.some((animation) => Number(animation.effect?.getComputedTiming().duration) > 0) });
        },
        () => seen.push({ what: "view transition skipped", moves: false }),
      );
      return transition;
    }) as typeof document.startViewTransition;
  });
/** What was recorded, with each animated element's text as it is now (a revealed message has grown since). */
const motionSeen = (page: Page): Promise<Motion[]> =>
  page.evaluate(() => (window as unknown as MotionWindow).e2eMotion.map(({ what, target, moves }) => ({ what, text: (target?.textContent ?? "").slice(0, 80), moves })));

test.describe("chat", () => {
  test("agent content stays inert: HTML, scripts and non-https links in every part of the chat render as text; a huge output is clipped", async ({ sandbox }) => {
    test.setTimeout(90_000);
    expect(HOSTILE.hugeChars, "the fake's huge output must exceed what the chat shows").toBeGreaterThan(MAX_SHOWN_CHARS * 2);
    await sandbox.startService(sandbox.workspace);
    const agentId = await startAgent(sandbox, "fake-hostile");
    await prompt(sandbox, agentId, "Show me everything.");
    await waitUntil("the hostile agent to wait on its two requests", WAIT_MS, async () => {
      const agent = await agentSummary(sandbox, agentId);
      return agent?.state === "waiting" && agent.pendingPermissions?.length === 2 ? true : undefined;
    });

    const launched = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
    const { page, app } = launched;
    await recordOpenExternal(app);
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

    // Every other place agent content shows: Needs me (the requests' titles), the Agents list (the message's
    // excerpt), and the edit's diff tab (its title from the agent's path, its texts in Monaco).
    const needsMeToggle = page.getByRole("button", { name: /^Needs me\b/ });
    if ((await needsMeToggle.getAttribute("aria-pressed")) !== "true") await click(needsMeToggle);
    const needsMe = page.getByRole("complementary", { name: "Needs me", exact: true });
    await expect(needsMe.getByRole("button")).toHaveCount(2, { timeout: WAIT_MS });
    const diffTab = `${HOSTILE.editFileName()} (diff)`;
    await click(chat.getByRole("region", { name: "Edit approval" }).getByRole("button", { name: "Open side by side" }));
    const diff = groupWithTab(page, diffTab);
    await expect(diff.locator(".monaco-diff-editor")).toHaveCount(1, { timeout: WAIT_MS });
    await expect(diff).toContainText("Opening hours", { timeout: WAIT_MS });
    expect((await layoutOf(page)).flatMap((group) => group.tabs), "the diff tab's title, as text").toContain(diffTab);
    const needsMeText = await needsMe.innerText();
    for (const where of ["permission title", "edit title"]) expect(needsMeText, `Needs me: the ${where} as text`).toContain(`<b>${where}</b>`);
    expect(await page.getByRole("complementary", { name: "Agents", exact: true }).innerText(), "the Agents list's excerpt").toContain("Hostile message starts.");
    // Monaco draws spaces as no-break spaces.
    const diffText = (await diff.innerText()).replace(/\u00a0/g, " ");
    for (const where of ["diff old", "diff new"]) expect(diffText, `the diff tab: the ${where} text`).toContain(`<b>${where}</b>`);

    // Everything is there to read, as text.
    const text = await chat.innerText();
    expect(text, "the edit card's file").toContain(HOSTILE.editFileName());
    for (const where of ["diff old", "diff new"]) expect(text, `the edit card: the ${where} text`).toContain(`<b>${where}</b>`);
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

    // Nothing runs, loads or links anywhere but https: in the whole page (sidebars, chat, diff tab and tab titles).
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
      await click(chat.getByText(`${label} message`).first());
    }
    await expect.poll(() => page.url()).toBe(startUrl);
    expect(app.windows()).toHaveLength(1);
    expect(await marker(page)).toBeUndefined();
    // Nothing reached the browser: not on render, not from those clicks.
    expect(await openedExternally(app), "a browser was opened without a click on an https link").toEqual([]);

    // The safe https link opens exactly its URL, once, on its click.
    await click(chat.getByRole("link", { name: "safe link message" }));
    await expect.poll(() => openedExternally(app)).toEqual(["https://example.invalid/docs"]);
    expect(await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))).toBeUndefined();
    expect(await openedExternally(app), "the click opened more than its URL once").toEqual(["https://example.invalid/docs"]);
    await expect.poll(() => page.url()).toBe(startUrl);
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

    await click(chat.getByRole("button", { name: "Approve", exact: true }));

    await waitUntil("the agent to end its turn", WAIT_MS, async () => ((await agentSummary(sandbox, agentId))?.state === "done" ? true : undefined));
    const log = await logOf(sandbox, agentId);
    expect(answersIn(log)).toEqual(["allow_once"]);
    expect(log.some((entry) => entry.update?.sessionUpdate === "tool_call_update" && entry.update.status === "completed")).toBe(true);
    await expect(chat.getByText(/approved/i).first()).toBeVisible({ timeout: WAIT_MS });
    await expect(chat.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await expect(chat.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
  });

  // S2d, T19 (row T19-9, which also took over footer.e2e's T14-8): a stopped agent's chat goes on. Its footer says it
  // isn't running (no line between the box and the footer), its settings stay usable and a pick starts it, and a
  // message typed in the chat resumes it: the reply lands in the same chat, under the same agent, on the model it had.
  test("resume: a stopped agent's chat says Not running, a setting picked starts it, and a message typed in it gets its reply in the same chat", async ({ sandbox }) => {
    test.setTimeout(120_000);
    await sandbox.startService(sandbox.workspace);
    const agentId = await startAgent(sandbox, "fake-reply");
    await prompt(sandbox, agentId, "Say hello to the bakery.");
    await waitForState(sandbox, agentId, "done");

    const launched = await sandbox.launch();
    const { page } = launched;
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    await waitForConnection(page, "connected");
    await openAgent(launched, agentId, 1);
    const chat = groupWithTab(page, REPO);
    const replies = chat.getByText("Hello from the fake agent.", { exact: true });
    await expect(replies, "the first reply").toHaveCount(1, { timeout: WAIT_MS });
    const notRunning = chat.getByText("Not running", { exact: true });
    await expect(notRunning, "a running agent has no indicator").toHaveCount(0);

    // Stopped while its settings dialog is open: the dialog stays, the buttons stay usable, the footer says so.
    const settings = chat.getByRole("button", { name: /^Settings:/ });
    const mode = chat.getByRole("button", { name: /^Mode:/ });
    await click(settings);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: WAIT_MS });
    await stop(sandbox, agentId);
    await expect(notRunning, "the indicator").toBeVisible({ timeout: WAIT_MS });
    await expect(dialog, "an open settings dialog stays open").toBeVisible();
    await expect(chat.getByText(/isn't running|Start a new agent/), "no line between the box and the footer").toHaveCount(0);

    // A setting picked starts the agent, and the value lands.
    const large = modelName("fake-large");
    await click(dialog.getByText(large, { exact: true }));
    await waitUntil("the agent running again on the model picked", WAIT_MS, async () =>
      (await hasProcess(sandbox, agentId)) && (await loggedModel(sandbox, agentId)) === "fake-large" ? true : undefined,
    );
    await expect(current(dialog, large), "the model picked, marked").toHaveCount(1, { timeout: WAIT_MS });
    await expect(notRunning, "running again").toHaveCount(0, { timeout: WAIT_MS });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: WAIT_MS });

    // Stopped again: a message typed in the chat starts it, and the reply lands here.
    await stop(sandbox, agentId);
    await expect(notRunning).toBeVisible({ timeout: WAIT_MS });
    // Checked with no dialog open: the modal dialog hides the rest of the page from the accessibility tree.
    await expect(settings, "settings stay usable while it isn't running").toBeEnabled();
    await expect(mode, "so does Mode").toBeEnabled();
    await notRunning.hover();
    await expect(page.getByText("Your next message starts it again", { exact: true }), "the indicator's tooltip").toBeVisible({ timeout: WAIT_MS });
    const tabs = await tabCount(page);
    const box = chat.getByRole("textbox", { name: "Message", exact: true });
    await box.fill("Are you still there?");
    await box.press("Enter");
    await expect(chat.getByText("Are you still there?", { exact: true }), "the message, in the chat").toBeVisible({ timeout: WAIT_MS });
    await expect(replies, "the second reply, in the same chat").toHaveCount(2, { timeout: WAIT_MS });
    await expect(notRunning, "running again").toHaveCount(0, { timeout: WAIT_MS });
    expect(await tabCount(page), "no new tab").toBe(tabs);
    const listed = await sandbox.api("GET", "/agents");
    expect((listed.json as { agents: { id: string }[] }).agents.map((agent) => agent.id), "no second agent").toEqual([agentId]);
    expect(await loggedModel(sandbox, agentId), "the model it had, after the resume").toBe("fake-large");
    await expect(settings, "the footer shows it").toContainText(large);
    expect(problems).toEqual([]);
  });

  test("motion: a message arriving in an open chat moves in; with reduced motion neither it nor the agent's row moving to another group moves", async ({ sandbox }) => {
    test.setTimeout(90_000);
    const title = "Opening hours";
    const say = (text: string) => ({ send: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
    await sandbox.startService(sandbox.workspace);
    const started = await sandbox.api("POST", "/agents", { harness: "fake-replay", repo: REPO });
    expect(started.status).toBe(201);
    const agentId = (started.json as { id: string }).id;
    await prompt(sandbox, agentId, JSON.stringify([{ send: { sessionUpdate: "session_info_update", title } }, say("The hours live in hours.md.")]));
    await waitForState(sandbox, agentId, "done");

    const launched = await sandbox.launch();
    const { page } = launched;
    await waitForConnection(page, "connected");
    await openAgent(launched, agentId, 1);
    const log = groupWithTab(page, title).getByRole("log", { name: "Conversation" });
    await expect(log.getByText("The hours live in hours.md.", { exact: true })).toBeVisible({ timeout: WAIT_MS });
    await recordMotion(page);

    // One turn per setting: a message arrives in the open chat while the agent's row moves from Done to Working. Each
    // waits for the message's animation to start and the row's view transition (run or skipped) before it's judged.
    const turn = async (reducedMotion: "no-preference" | "reduce", text: string): Promise<Motion[]> => {
      await page.emulateMedia({ reducedMotion });
      const from = (await motionSeen(page)).length;
      const release = join(sandbox.base, `release-${reducedMotion}`);
      await prompt(sandbox, agentId, JSON.stringify([say(text), { awaitFile: release }]));
      await expect(log.getByText(text, { exact: true })).toBeVisible({ timeout: WAIT_MS });
      const seen = await waitUntil(`the arriving message's animation and the row's view transition (${reducedMotion})`, WAIT_MS, async () => {
        const since = (await motionSeen(page)).slice(from);
        const arrived = since.some((motion) => motion.what === "animation" && motion.text === text && (reducedMotion === "reduce" || motion.moves));
        return arrived && since.some((motion) => motion.what.startsWith("view transition")) ? since : undefined;
      });
      writeFileSync(release, "");
      await waitForState(sandbox, agentId, "done");
      return seen;
    };

    await turn("no-preference", "I moved the hours into the footer.");
    const reduced = await turn("reduce", "The footer now reads them from hours.md.");
    expect(reduced.filter((motion) => motion.moves), "with reduced motion, nothing moves").toEqual([]);
  });
});

const stop = async (sandbox: Sandbox, agentId: string): Promise<void> => {
  const stopped = await sandbox.api("POST", `/agents/${agentId}/stop`);
  expect(stopped.status, "stop through the api").toBe(204);
};

const hasProcess = async (sandbox: Sandbox, agentId: string): Promise<boolean> => {
  const listed = await sandbox.api("GET", "/agents");
  return (listed.json as { agents: { id: string; hasProcess?: boolean }[] }).agents.find((agent) => agent.id === agentId)?.hasProcess === true;
};

type ConfigEntry = { update?: { sessionUpdate?: string; configOptions?: { id: string; currentValue?: unknown }[] } };

/** The model the service's log says the agent uses (its latest config_option_update). */
const loggedModel = async (sandbox: Sandbox, agentId: string): Promise<unknown> => {
  const entries = (await logOf(sandbox, agentId)) as ConfigEntry[];
  const latest = entries.filter((entry) => entry.update?.sessionUpdate === "config_option_update").at(-1);
  return latest?.update?.configOptions?.find((option) => option.id === FAKE_CONFIG.model.id)?.currentValue;
};

/** A model value's name as the fake agent offers it. */
const modelName = (value: string): string => {
  const [model] = fakeConfigOptions({ model: FAKE_CONFIG.model.initial, fast: FAKE_CONFIG.fast.initial });
  const option = model?.type === "select" ? model.options.find((candidate) => "value" in candidate && candidate.value === value) : undefined;
  return option && "name" in option ? option.name : value;
};

