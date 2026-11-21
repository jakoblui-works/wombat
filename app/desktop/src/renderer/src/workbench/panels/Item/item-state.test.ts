// What an item tab shows claims only what its reads show: a read the bridge refused keeps the last item, the service's
// answers decide between an error, an unparseable file, a missing item and a gone one, the binders between a broken,
// a missing and a gone binder, and a file moved by hand shows under the binder whose folder now holds it. Once a tab
// has a form (an item read, or a draft whose binder was listed), it keeps it through every state after, in the binder
// last listed, savable only while the item is shown.
import { describe, expect, test } from "vitest";

import type { BinderSummary, Item, ItemSummary } from "@wombat/shared/items";

import { ServiceError } from "../../../data/client.ts";
import { NO_FILE } from "./item-edit.ts";
import { type Binder, draftShown, itemForm, itemShown } from "./item-state.ts";

const ITEM_ID = "0196f3c2-0000-7000-8000-000000000001";

const listing = (path: string) => ({ path, itemCount: 1, invalidCount: 0, problems: [] });
const binder = (id: string, path: string): BinderSummary => ({
  id,
  name: `Invented ${id}`,
  prefix: "TSK",
  access: "edit",
  naming: "handle",
  instructions: "off",
  properties: {},
  views: [],
  ...listing(path),
});
const broken = (path: string): BinderSummary => ({ id: null, ...listing(path), problems: [{ message: "The settings don't parse." }] });

const TASKS = binder("tasks", "work/tasks");
const ARCHIVE = binder("archive", "work/archive");

const item = (path = "work/tasks/TSK-1-rotate-cert.md"): Item => ({
  id: ITEM_ID,
  handle: "TSK-1",
  aliases: [],
  title: "Rotate the staging certificate",
  properties: {},
  path,
  version: "0".repeat(64),
  problems: [],
  excerpt: "Renew it through the pipeline.",
  binder: "tasks",
  body: "Renew it through the pipeline.\n",
});
const LAST = item();

const entry = (path: string, id: string | null): ItemSummary => ({ ...item(path), id, handle: id === null ? null : "TSK-9" });
const OTHER = entry("work/tasks/TSK-9-other.md", "0196f3c2-0000-7000-8000-000000000009");
const UNREADABLE = entry("work/tasks/TSK-7-broken-yaml.md", null);

const notFound = new ServiceError(404, { code: "item_not_found", message: "There's no item TSK-1." });
/** A read the bridge refused while not connected: it never reached the service. */
const refused = new Error("The service isn't connected.");

const ok = <T>(data: T) => ({ data, error: null });

describe("itemShown", () => {
  test.each([
    {
      what: "a refused read keeps the last item",
      reads: { item: { data: LAST, error: refused }, binders: ok([TASKS]), listed: ok([entry(LAST.path, ITEM_ID)]) },
      shows: { kind: "item", item: LAST, binder: { id: "tasks" } },
    },
    {
      what: "the service's error on the item, with no item read before, shows the error",
      reads: { item: { data: undefined, error: new ServiceError(500, { code: "internal", message: "The service failed to read the file." }) }, binders: ok([TASKS]), listed: ok([OTHER]) },
      shows: { kind: "error", what: "item", message: "The service failed to read the file." },
    },
    {
      what: "not found, and its last path is listed without an id: the file can't be parsed",
      reads: { item: { data: LAST, error: notFound }, binders: ok([TASKS]), listed: ok([OTHER, entry(LAST.path, null)]) },
      shows: { kind: "unparseable", last: LAST, binder: { id: "tasks" } },
    },
    {
      what: "not found, with no last read to check: missing",
      reads: { item: { data: undefined, error: notFound }, binders: ok([TASKS]), listed: ok([OTHER]) },
      shows: { kind: "missing", binder: { id: "tasks" } },
    },
    {
      what: "not found, its last path not listed, and a file in the binder can't be parsed: missing, not gone",
      reads: { item: { data: LAST, error: notFound }, binders: ok([TASKS]), listed: ok([OTHER, UNREADABLE]) },
      shows: { kind: "missing", last: LAST, binder: { id: "tasks" } },
    },
    {
      what: "not found, its last path not listed, and every file parses: gone",
      reads: { item: { data: LAST, error: notFound }, binders: ok([TASKS]), listed: ok([OTHER]) },
      shows: { kind: "gone", last: LAST, binder: { id: "tasks" } },
    },
    {
      what: "the binder isn't listed and a broken binder's folder holds the item: that binder is broken",
      reads: { item: { data: LAST, error: notFound }, binders: ok([ARCHIVE, broken("work/tasks")]), listed: { data: undefined, error: notFound } },
      shows: { kind: "binder-broken", binder: { path: "work/tasks" }, last: LAST },
    },
    {
      what: "the binder isn't listed and another binder is broken: it may be that one",
      reads: { item: { data: LAST, error: notFound }, binders: ok([ARCHIVE, broken("work/notes")]), listed: { data: undefined, error: notFound } },
      shows: { kind: "binder-missing", last: LAST },
    },
    {
      what: "the binder isn't listed and no binder is broken: gone",
      reads: { item: { data: LAST, error: notFound }, binders: ok([ARCHIVE]), listed: { data: undefined, error: notFound } },
      shows: { kind: "binder-gone", last: LAST },
    },
    {
      what: "a file moved by hand into another binder shows under the binder whose folder holds it",
      reads: { item: ok(item("work/archive/TSK-1-rotate-cert.md")), binders: ok([TASKS, ARCHIVE]), listed: ok([OTHER]) },
      shows: { kind: "item", binder: { id: "archive" } },
    },
  ])("$what", ({ reads, shows }) => {
    expect(itemShown(ITEM_ID, "tasks", reads)).toMatchObject(shows);
  });
});

describe("itemForm", () => {
  const tasks = TASKS as Binder;
  const archive = ARCHIVE as Binder;
  /** The reads after the tab showed LAST in TASKS: what each later state of the tab is shown from. */
  const LATER = [
    { what: "the file can't be parsed", reads: { item: { data: LAST, error: notFound }, binders: ok([TASKS]), listed: ok([entry(LAST.path, null)]) } },
    { what: "its binder is broken", reads: { item: { data: LAST, error: notFound }, binders: ok([ARCHIVE, broken("work/tasks")]), listed: { data: undefined, error: notFound } } },
    { what: "its binder is missing", reads: { item: { data: LAST, error: notFound }, binders: ok([ARCHIVE, broken("work/notes")]), listed: { data: undefined, error: notFound } } },
    {
      what: "the service failed the binders",
      reads: { item: { data: LAST, error: null }, binders: { data: undefined, error: new ServiceError(500, { code: "internal", message: "The service failed to read the binders." }) }, listed: ok([entry(LAST.path, ITEM_ID)]) },
    },
  ];

  test("an item tab's form is savable while it shows the item", () => {
    const shown = itemShown(ITEM_ID, "tasks", { item: ok(LAST), binders: ok([TASKS]), listed: ok([entry(LAST.path, ITEM_ID)]) });
    expect(itemForm(shown, undefined, false)).toEqual({ item: LAST, binder: tasks, savable: true });
  });

  test.each(LATER)("once read, an item tab keeps its form, unsavable, in the binder last listed when $what", ({ reads }) => {
    const shown = itemShown(ITEM_ID, "tasks", reads);
    expect(shown.kind).not.toBe("item");
    expect(itemForm(shown, tasks, false)).toEqual({ item: LAST, binder: tasks, savable: false });
  });

  test("the binder shown now comes before the one last listed", () => {
    const moved = item("work/archive/TSK-1-rotate-cert.md");
    const shown = itemShown(ITEM_ID, "tasks", { item: ok(moved), binders: ok([TASKS, ARCHIVE]), listed: ok([OTHER]) });
    expect(itemForm(shown, tasks, false)?.binder).toEqual(archive);
  });

  test("a draft has a form once its binder was listed, and keeps it, unsavable, while the binder isn't", () => {
    expect(itemForm(draftShown("tasks", ok([TASKS])), undefined, true)).toEqual({ item: NO_FILE, binder: tasks, savable: true });
    for (const binders of [ok([ARCHIVE]), ok([ARCHIVE, broken("work/notes")])]) {
      const shown = draftShown("tasks", binders);
      expect(itemForm(shown, undefined, true), `${shown.kind}, never listed`).toBeUndefined();
      expect(itemForm(shown, tasks, true), `${shown.kind}, listed before`).toEqual({ item: NO_FILE, binder: tasks, savable: false });
    }
  });
});
