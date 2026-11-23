// Whether New's ask for the focus still stands when the message box mounts, or the user has put the focus elsewhere.
import { expect, test } from "vitest";

import { newChatFocusStands } from "./new-chat-focus.ts";

// Stand-ins for the page's elements: the function looks only at identity and the tag name.
const newButton = { tagName: "BUTTON" };
const agentRow = { tagName: "BUTTON" };
const searchBox = { tagName: "INPUT" };
const body = { tagName: "BODY" };
const menuItem = { tagName: "DIV" };

type Focus = { tagName: string } | null;
/** The case, the focus at the ask, the focus now, whether it's now in the title bar's menus, and whether the ask stands. */
type Case = [string, Focus, Focus, boolean, boolean];

test("the ask stands while the focus is where it was, on nothing, on the page or in the title bar's menus; it yields where the user put it since", () => {
  const cases: Case[] = [
    ["still on the element it was on", newButton, newButton, false, true],
    ["on nothing", newButton, null, false, true],
    ["on the page itself", newButton, body, false, true],
    ["on nothing at the ask, now on the page", null, body, false, true],
    ["in the title bar's menus", newButton, menuItem, true, true],
    ["on another button the user clicked", newButton, agentRow, false, false],
    ["in a text box the user typed in", newButton, searchBox, false, false],
    ["on an element, after an ask made with nothing focused", null, searchBox, false, false],
    ["on an element, after an ask made on the page", body, agentRow, false, false],
  ];
  for (const [name, atRequest, now, nowInMenus, stands] of cases) expect(newChatFocusStands(atRequest, now, nowInMenus), name).toBe(stands);
});
