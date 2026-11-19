// A binder's board view, against the built app with an items root (WOMBAT_ITEMS) the test writes: moving a card to
// another column, by mouse or by keyboard, writes only the column's property to its file; a drop onto a file changed
// by hand since the board read it writes nothing and the card goes back. What it relies on in the page: the Desk
// activity and its binder `treeitem` opening the binder's first view (the board); each column a `region` named by its
// label; each card a `button` named with the item's title, a native drag source, picked up and dropped with Space and
// moved with the arrow keys while focused.
// To hold a hand edit back from the board (so a drop lands on the version it read), main's webContents.send keeps the
// items alerts back until they are let through.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ElectronApplication, Locator, Page } from "@playwright/test";

import { CHANNELS } from "../src/shared/bridge.ts";
import { click, expect, type Sandbox, SWITCH, test, waitForConnection, waitUntil, WAIT_MS } from "./app-fixtures.ts";

// ---- The items root (invented) ----

const BINDER = "Operations";
const SETTINGS = `version: 1
id: ops
name: ${BINDER}
prefix: OPS
access: propose
properties:
  stage: { type: select, options: [queued, active, review] }
  effort: { type: number }
  owner: { type: text }
views:
  - { name: Flow, kind: board, column: stage }
`;

type Card = { n: number; title: string; stage: string };
const CARDS: Card[] = [
  { n: 1, title: "Rotate the staging certificates", stage: "queued" },
  { n: 2, title: "Trim the nightly backup window", stage: "queued" },
  { n: 3, title: "Patch the ingress controller", stage: "active" },
];
const [ROTATE, TRIM, PATCH] = CARDS as [Card, Card, Card];

/** As written by hand: a comment, keys out of order, a blank line, a quoted value and a body, all to be kept. */
const cardText = (c: Card, body = "Check the runbook first.\n"): string =>
  `---\n# Kept by the platform rota.\nid: 0196f3c2-8e00-7000-8000-${c.n.toString(16).padStart(12, "0")}\nhandle: OPS-${String(c.n)}\neffort: 2 # rough days\nstage: ${c.stage}\n\nowner: "on-call rota"\n---\n# ${c.title}\n\n${body}`;
const fileOf = (root: string, c: Card): string => path.join(root, "ops", `OPS-${String(c.n)}.md`);

// ---- Holding items alerts back in main ----

const HELD = "__wombatBoardHeldAlerts";
const holdAlerts = (app: ElectronApplication): Promise<void> =>
  app.evaluate(
    ({ BrowserWindow }, [channel, key]) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      if (contents === undefined) throw new Error("no window to hold alerts for");
      const held: unknown[][] = [];
      const send = contents.send.bind(contents);
      (globalThis as Record<string, unknown>)[key] = held;
      contents.send = (ch: string, ...args: unknown[]): void => {
        if (ch === channel) held.push(args);
        else send(ch, ...args);
      };
    },
    [CHANNELS.alert, HELD] as const,
  );
const heldCount = (app: ElectronApplication): Promise<number> =>
  app.evaluate((_electron, key) => ((globalThis as unknown as Record<string, unknown[] | undefined>)[key]?.length ?? 0), HELD);

// ---- CSP violations and page errors ----

const VIOLATIONS = "__wombatE2eCspViolations";
const watchProblems = async (page: Page): Promise<string[]> => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  await page.evaluate((key) => {
    const seen: string[] = [];
    (window as unknown as Record<string, unknown>)[key] = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} blocked ${event.blockedURI || "(inline)"} at ${event.sourceFile}:${String(event.lineNumber)}`);
    });
  }, VIOLATIONS);
  return problems;
};
const violations = (page: Page): Promise<string[]> =>
  page.evaluate((key) => [...((window as unknown as Record<string, string[] | undefined>)[key] ?? ["(recorder missing)"])], VIOLATIONS);

// ---- The board ----

const column = (board: Locator, label: string): Locator => board.getByRole("region", { name: label, exact: true });
const card = (col: Locator, c: Card): Locator => col.getByRole("button", { name: new RegExp(c.title) });

const openBoard = async (sandbox: Sandbox) => {
  const root = path.join(sandbox.base, "items");
  mkdirSync(path.join(root, "ops"), { recursive: true });
  writeFileSync(path.join(root, "ops", "_binder.yaml"), SETTINGS);
  for (const c of CARDS) writeFileSync(fileOf(root, c), cardText(c));
  await sandbox.startService(sandbox.workspace, { WOMBAT_ITEMS: root });

  const launched = await sandbox.launch({ env: { [SWITCH.quitAnswer]: "leave" } });
  const { page } = launched;
  await waitForConnection(page, "connected");
  const problems = await watchProblems(page);
  const desk = page.getByRole("navigation", { name: "Activities" }).getByRole("button", { name: "Desk", exact: true });
  if ((await desk.getAttribute("aria-pressed")) !== "true") await click(desk);
  await click(page.getByRole("complementary", { name: "Desk", exact: true }).getByRole("treeitem", { name: new RegExp(`^${BINDER}`) }));
  const board = page.locator(".dv-content-container").filter({ has: page.getByRole("region", { name: "review", exact: true }) });
  await expect(card(column(board, "queued"), ROTATE)).toBeVisible({ timeout: WAIT_MS });
  return { root, launched, page, board, problems };
};

/** A native drag by mouse from the card to the column. */
const dragByMouse = async (page: Page, source: Locator, target: Locator): Promise<void> => {
  const centre = (locator: Locator) =>
    locator.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
  const from = await centre(source);
  const to = await centre(target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
};

const changedFile = (file: string, before: string, what: string): Promise<string> =>
  waitUntil(what, WAIT_MS, () => {
    const now = readFileSync(file, "utf8");
    return now === before ? undefined : now;
  });

test.describe("the board", () => {
  test("moving a card to another column by mouse or by keyboard writes only that property; the rest of its file stays byte for byte", async ({ sandbox }) => {
    test.setTimeout(120_000);
    const { root, page, board, problems } = await openBoard(sandbox);

    const rotate = fileOf(root, ROTATE);
    const rotateBefore = readFileSync(rotate, "utf8");
    await dragByMouse(page, card(column(board, "queued"), ROTATE), column(board, "active"));
    await expect(card(column(board, "active"), ROTATE), "in active after the drop").toBeVisible({ timeout: WAIT_MS });
    expect(await changedFile(rotate, rotateBefore, "the mouse drop written")).toBe(cardText({ ...ROTATE, stage: "active" }));

    // Retitled by hand while held, and shown on the board before the drop: the drop names the version the board holds
    // then, not the one it held at the pick.
    const trim = fileOf(root, TRIM);
    const retitled = { ...TRIM, title: "Trim the weekly backup window" };
    await card(column(board, "queued"), TRIM).focus();
    await page.keyboard.press("Space");
    writeFileSync(trim, cardText(retitled));
    await expect(card(column(board, "queued"), retitled), "the hand edit on the board").toBeVisible({ timeout: WAIT_MS });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await expect(card(column(board, "active"), retitled), "in active after the drop").toBeVisible({ timeout: WAIT_MS });
    expect(await changedFile(trim, cardText(retitled), "the keyboard drop written")).toBe(cardText({ ...retitled, stage: "active" }));

    expect(await violations(page), "CSP violations").toEqual([]);
    expect(problems, "page errors").toEqual([]);
  });

  test("a drop onto a file changed by hand since the board read it keeps the hand edit, and the card goes back", async ({ sandbox }) => {
    test.setTimeout(120_000);
    const { root, launched, page, board, problems } = await openBoard(sandbox);
    const file = fileOf(root, PATCH);

    await holdAlerts(launched.app);
    const handEdited = cardText(PATCH, "Edited by hand while the board was open.\n");
    writeFileSync(file, handEdited);
    await waitUntil("the hand edit's items alert (held in main)", WAIT_MS, async () => ((await heldCount(launched.app)) > 0 ? true : undefined));

    await dragByMouse(page, card(column(board, "active"), PATCH), column(board, "review"));
    await expect(board.getByRole("alert"), "the board says why the card stayed").toBeVisible({ timeout: WAIT_MS });
    await expect(card(column(board, "active"), PATCH), "back in active").toBeVisible({ timeout: WAIT_MS });
    await expect(card(column(board, "review"), PATCH), "not left in review").toHaveCount(0);
    expect(readFileSync(file, "utf8"), "the hand edit kept, byte for byte").toBe(handEdited);

    expect(await violations(page), "CSP violations").toEqual([]);
    expect(problems, "page errors").toEqual([]);
  });
});
