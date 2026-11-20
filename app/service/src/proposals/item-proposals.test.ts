// Whether an approved item change is what the items hold now. A restart settles a proposal left mid-write by this
// answer alone: a wrong "not written" makes a second approve create the item twice, a wrong "written" reports a
// delete as done while its item lives on.
import { expect, test } from "vitest";

import type { LoadedItem } from "../items/catalog.ts";
import { itemWritten, type StoredItemProposal } from "./item-proposals.ts";

const ITEM_ID = "0196f3c2-1a00-7000-8000-000000000001";
const OTHER_ID = "0196f3c2-1a00-7000-8000-000000000002";
const PATH = "bugs/BUG-1-login-times-out.md";

const item = (id: string, version: string): LoadedItem => ({
  id,
  handle: "BUG-1",
  aliases: [],
  title: "Login times out",
  properties: {},
  path: PATH,
  version,
  problems: [],
  body: "",
  binder: "bugs",
});

/** A proposal being applied: a create has no item yet, an update and a delete name ITEM_ID. */
const applying = (kind: StoredItemProposal["kind"], intent: unknown): StoredItemProposal => ({
  id: "0196f3c2-1a00-7000-8000-0000000000aa",
  target: "item",
  path: null,
  binder: "bugs",
  itemId: kind === "create" ? null : ITEM_ID,
  kind,
  file: null,
  reason: "Reported twice",
  baseVersion: kind === "create" ? null : "v1",
  status: "applying",
  agentId: "agent-1",
  at: "2026-11-09T10:02:11.120Z",
  ...(intent === undefined ? {} : { intent }),
});

const others = [item(OTHER_ID, "v1")];

// [what, kind, intent, the items now, a delete's file is missing, written]
const cases: [string, StoredItemProposal["kind"], unknown, LoadedItem[], boolean, boolean][] = [
  ["a create whose item exists", "create", { itemId: ITEM_ID }, [...others, item(ITEM_ID, "v1")], false, true],
  ["a create whose item doesn't exist", "create", { itemId: ITEM_ID }, others, false, false],
  ["a create with no intent", "create", undefined, [...others, item(ITEM_ID, "v1")], false, false],
  ["an update whose item is at the intent's version", "update", { itemId: ITEM_ID, version: "v2" }, [item(ITEM_ID, "v2")], false, true],
  ["an update whose item is at another version", "update", { itemId: ITEM_ID, version: "v2" }, [item(ITEM_ID, "v1")], false, false],
  ["an update whose item is gone", "update", { itemId: ITEM_ID, version: "v2" }, others, false, false],
  ["an update whose resulting version wasn't known", "update", { itemId: ITEM_ID, version: null }, [item(ITEM_ID, "v1")], false, false],
  ["a delete whose file is missing and whose item is gone", "delete", { itemId: ITEM_ID, path: PATH }, others, true, true],
  ["a delete whose file is missing while its item lives on elsewhere", "delete", { itemId: ITEM_ID, path: PATH }, [item(ITEM_ID, "v1")], true, false],
  ["a delete whose file is still there", "delete", { itemId: ITEM_ID, path: PATH }, others, false, false],
  ["a delete whose item wasn't there to delete (no path)", "delete", { itemId: ITEM_ID, path: null }, others, true, false],
];

test.each(cases)("written: %s", (_what, kind, intent, items, fileMissing, written) => {
  const answer = itemWritten(applying(kind, intent), { items, binderRead: true, fileMissing });

  expect(answer?.written ?? false).toBe(written);
  if (kind === "create" && written) expect(answer?.itemId, "the created item's id").toBe(ITEM_ID);
  // A binder that wasn't read whole can't tell: an answer either way could be wrong.
  expect(() => itemWritten(applying(kind, intent), { items, binderRead: false, fileMissing })).toThrow();
});
