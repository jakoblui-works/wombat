// The rows an item proposal's tab shows, which Approve's fields are read from: a field my draft leaves out is dropped
// (not mine, not sent), a field my draft holds shows my value, and a delete shows the item as it is, read-only.
import { expect, test } from "vitest";

import type { Item } from "@wombat/shared/items";
import type { ItemProposalKind } from "@wombat/shared/proposals";

import { fieldRows, type FieldRow } from "./field-rows.ts";

const PARENT_ID = "0196f3c2-1a00-7000-8000-00000000b001";

const TOOLTIP: Item = {
  id: "0196f3c2-1a00-7000-8000-00000000b003",
  handle: "BUG-3",
  aliases: [],
  title: "Tooltip stays open after hover",
  body: "\nThe tooltip stays open after the pointer leaves the icon.\n",
  properties: { status: "open", due: "2026-11-30", parent: { id: PARENT_ID, handle: "BUG-1" } },
  path: "bugs/tooltip.md",
  version: "b".repeat(64),
  problems: [],
  excerpt: "The tooltip stays open after the pointer leaves the icon.",
  binder: "bugs",
};

const TOUCH_BODY = "\nThe tooltip stays open after the pointer leaves the icon, on touch screens only.\n";
const NEW_ITEM = { title: "Checkout total rounds the wrong way", body: "\nSeen with three items in the cart.\n", status: "open" };

type Case = { item: Item | null; version: Record<string, unknown>; draft?: Record<string, unknown>; kind: ItemProposalKind; rows: FieldRow[] };

const byName = (rows: FieldRow[]): FieldRow[] => [...rows].sort((a, b) => a.name.localeCompare(b.name));

test.each<[string, Case]>([
  [
    "an update of a property and the body: those two rows, old beside proposed",
    {
      item: TOOLTIP,
      version: { status: "fixed", body: TOUCH_BODY },
      kind: "update",
      rows: [
        { name: "status", old: "open", proposed: "fixed", dropped: false },
        { name: "body", old: TOOLTIP.body, proposed: TOUCH_BODY, dropped: false },
      ],
    },
  ],
  [
    "my draft leaves out a field the agent set: it is dropped, with no value of mine",
    {
      item: TOOLTIP,
      version: { status: "fixed", body: TOUCH_BODY },
      draft: { body: TOUCH_BODY },
      kind: "update",
      rows: [
        { name: "status", old: "open", proposed: "fixed", dropped: true },
        { name: "body", old: TOOLTIP.body, proposed: TOUCH_BODY, mine: TOUCH_BODY, dropped: false },
      ],
    },
  ],
  [
    "my draft edits a value: mine beside the agent's",
    {
      item: TOOLTIP,
      version: { status: "fixed", due: "2026-12-01" },
      draft: { status: "fixed", due: "2026-12-04" },
      kind: "update",
      rows: [
        { name: "status", old: "open", proposed: "fixed", mine: "fixed", dropped: false },
        { name: "due", old: "2026-11-30", proposed: "2026-12-01", mine: "2026-12-04", dropped: false },
      ],
    },
  ],
  [
    "a create: every field new",
    {
      item: null,
      version: NEW_ITEM,
      kind: "create",
      rows: Object.entries(NEW_ITEM).map(([name, proposed]) => ({ name, old: undefined, proposed, dropped: false })),
    },
  ],
  [
    "a delete: the item's own fields, none editable",
    {
      item: TOOLTIP,
      version: {},
      kind: "delete",
      rows: [
        { name: "title", old: TOOLTIP.title, proposed: undefined, dropped: false },
        { name: "body", old: TOOLTIP.body, proposed: undefined, dropped: false },
        { name: "status", old: "open", proposed: undefined, dropped: false },
        { name: "due", old: "2026-11-30", proposed: undefined, dropped: false },
        { name: "parent", old: { id: PARENT_ID, handle: "BUG-1" }, proposed: undefined, dropped: false },
      ],
    },
  ],
])("%s", (_name, { item, version, draft, kind, rows }) => {
  const shown = fieldRows(item, version, draft, kind);
  expect(byName(shown)).toEqual(byName(rows));
});
