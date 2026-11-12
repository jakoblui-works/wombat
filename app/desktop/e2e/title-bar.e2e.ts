// The title bar's menus and focus, against the built app, through real input (mouse clicks and keys). Opening a menu
// moves focus into the menubar, and Edit's commands act on whatever has focus, so where focus goes when a menu closes
// decides what they act on:
// - a menu opened with the mouse, or one whose item was chosen, gives focus back to the element that had it before;
// - a menu opened and dismissed from the keyboard leaves focus on its trigger, where the user was;
// - how one open went never carries over to the next.
// What this relies on in the page: the title bar is the `banner` landmark, its menus are `menuitem` triggers named
// File and Edit opening a `menu` whose items are `menuitem`s named by the command's title ("Select All"); a chat's
// composer is the `textbox` "Message".
import type { Locator, Page } from "@playwright/test";
import { click, expect, openAgent, startAgent, SWITCH, test, waitForConnection, WAIT_MS } from "./app-fixtures.ts";

const trigger = (page: Page, name: string): Locator => page.getByRole("banner").getByRole("menuitem", { name, exact: true });

/** What has focus: a menubar trigger by its text, the composer, something inside a dialog, or the element's tag. */
const focused = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) return "nothing";
    if (active.closest('[role="dialog"]') !== null) return "in the dialog";
    if (active.getAttribute("aria-label") === "Message") return "the composer";
    if (active.closest('header [role="menubar"]') !== null) return `the ${(active.textContent ?? "").trim()} trigger`;
    return `${active.tagName.toLowerCase()} ${(active.getAttribute("aria-label") ?? active.textContent ?? "").trim().slice(0, 30)}`;
  });

const openMenu = (page: Page): Locator => page.getByRole("menu");

/** Escape on an open menu, once it's showing; resolves once it has closed. */
const dismiss = async (page: Page): Promise<void> => {
  await expect(openMenu(page)).toBeVisible({ timeout: WAIT_MS });
  await page.keyboard.press("Escape");
  await expect(openMenu(page)).toBeHidden({ timeout: WAIT_MS });
};

/** Opens the menu from the keyboard: focus on its trigger, then Enter. */
const openByKeyboard = async (page: Page, name: string): Promise<void> => {
  await trigger(page, name).focus();
  await page.keyboard.press("Enter");
};

const expectFocus = async (page: Page, where: string, why: string): Promise<void> => {
  await expect.poll(() => focused(page), { message: why, timeout: WAIT_MS }).toBe(where);
};

test.describe("title bar menus", () => {
  test("a menu gives focus back where the user was: Edit acts on the focused field, a keyboard-dismissed menu stays on its trigger, and no open carries over to the next", async ({ sandbox }) => {
    test.setTimeout(60_000);
    await sandbox.startService(sandbox.workspace);
    const agentId = await startAgent(sandbox, "fake-reply");
    const launched = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
    const { page } = launched;
    await waitForConnection(page, "connected");
    await openAgent(launched, agentId, 1);
    const composer = page.getByRole("textbox", { name: "Message", exact: true });

    await test.step("Edit opened with the mouse: Select All selects the focused field's text, and focus is back on it", async () => {
      const text = "Bring the sourdough order forward";
      await click(composer);
      await page.keyboard.type(text);
      // The caret at the end, nothing selected: a Select All that missed the field leaves it so.
      expect(await composer.evaluate((field: HTMLTextAreaElement) => [field.selectionStart, field.selectionEnd])).toEqual([text.length, text.length]);
      await click(trigger(page, "Edit"));
      await expect(openMenu(page)).toBeVisible({ timeout: WAIT_MS });
      await click(openMenu(page).getByRole("menuitem", { name: /^Select All/ }));
      await expect(openMenu(page)).toBeHidden({ timeout: WAIT_MS });
      await expect
        .poll(() => composer.evaluate((field: HTMLTextAreaElement) => [field.selectionStart, field.selectionEnd]), {
          message: "Select All didn't select the composer's text",
          timeout: WAIT_MS,
        })
        .toEqual([0, text.length]);
      await expectFocus(page, "the composer", "focus didn't come back to the composer after Select All");
    });

    await test.step("Edit opened from the keyboard and dismissed with Escape: focus stays on its trigger", async () => {
      await click(composer);
      await openByKeyboard(page, "Edit");
      await dismiss(page);
      await expectFocus(page, "the Edit trigger", "a keyboard-dismissed menu moved focus off its trigger");
    });

    await test.step("no open carries over: after a mouse open elsewhere and a click in the field, a keyboard open and Escape still stay on the trigger", async () => {
      await openByKeyboard(page, "Edit");
      await dismiss(page);
      await click(trigger(page, "File"));
      await dismiss(page);
      await click(composer);
      await expectFocus(page, "the composer", "clicking the composer didn't focus it");
      await openByKeyboard(page, "File");
      await dismiss(page);
      await expectFocus(page, "the File trigger", "after a mouse open of File, a keyboard-dismissed File sent focus to the field");
      await openByKeyboard(page, "Edit");
      await dismiss(page);
      await expectFocus(page, "the Edit trigger", "after the mixed opens, a keyboard-dismissed Edit sent focus to the field");
    });
  });
});
