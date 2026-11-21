// The preview box: the state it shows from a read, which rows have one, how Space and the focus drive it, and the name
// it gives an item it can't show, never a raw id. Items invented.
import fc from "fast-check";
import { expect, test } from "vitest";

import { ItemsErrorCode } from "@wombat/shared/api";
import type { Item, ItemSummary } from "@wombat/shared/items";
import type { ItemProposal } from "@wombat/shared/proposals";

import { ServiceError } from "../../../../data/client.ts";
import type { Row } from "../view-model/view-model.ts";
import { type PreviewKeys, previewName, previewOnFocus, previewOnSpace, previewShown, rowPreview } from "./item-preview.ts";

const ID = "0196f3c2-0000-7000-8000-000000000001";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const summary = (n: number, { id = `0196f3c2-0000-7000-8000-${n.toString(16).padStart(12, "0")}`, handle = `HV-${String(n)}` }: { id?: string | null; handle?: string | null } = {}): ItemSummary => ({
  id,
  handle,
  aliases: [],
  title: `Invented hive ${String(n)}`,
  properties: {},
  path: `hives/HV-${String(n)}.md`,
  version: "0".repeat(64),
  problems: [],
  excerpt: null,
  binder: "hives",
});
const ITEM: Item = { ...summary(1, { id: ID }), body: "Check the frames.\n" };
const UNPARSEABLE = summary(2, { id: null, handle: null });

const proposed = (kind: ItemProposal["kind"], handle: string | null): ItemProposal => ({
  target: "item",
  id: "0196f3c2-0000-7000-8000-0000000000a0",
  status: "pending",
  agentId: "0196f3c2-0000-7000-8000-0000000000a9",
  reason: "Invented reason.",
  version: 1,
  editedByMe: false,
  at: new Date(Date.UTC(2026, 10, 2, 9)).toISOString(),
  binder: "hives",
  kind,
  handle,
  file: null,
});

test("the preview box: which state it shows, which rows have one, its keyboard mode, and never a raw id", () => {
  // Which state a read shows.
  const notFound = new ServiceError(404, { code: ItemsErrorCode.enum.item_not_found, message: "No item HV-404." });
  const otherError = new ServiceError(503, { code: ItemsErrorCode.enum.items_not_configured, message: "No items folder." });
  const reads: [string, { data: Item | undefined; error: unknown }, ItemSummary | undefined, string][] = [
    ["nothing yet", { data: undefined, error: null }, undefined, "loading"],
    ["the item", { data: ITEM, error: null }, ITEM, "item"],
    ["not found", { data: undefined, error: notFound }, undefined, "not-found"],
    ["not found after an earlier read", { data: ITEM, error: notFound }, ITEM, "not-found"],
    ["another service error", { data: undefined, error: otherError }, undefined, "error"],
    ["a plain error", { data: undefined, error: new Error("offline") }, undefined, "error"],
    ["a listing without an id, nothing read", { data: undefined, error: null }, UNPARSEABLE, "unparseable"],
    ["a listing without an id, not found", { data: undefined, error: notFound }, UNPARSEABLE, "unparseable"],
    ["a listing without an id, data", { data: ITEM, error: null }, UNPARSEABLE, "unparseable"],
  ];
  for (const [what, read, listed, kind] of reads) expect(previewShown(read, listed).kind, what).toBe(kind);

  // Which rows have a box: only an item's, parseable or not.
  const itemRow: Row = { item: ITEM };
  const unparseableRow: Row = { item: UNPARSEABLE };
  const pendingRow: Row = { pending: proposed("create", null), fields: {}, link: (_to, id) => ({ id, handle: null }) };
  const missingRow: Row = { missing: "HV-7", proposals: [proposed("update", "HV-7")] };
  expect(rowPreview(itemRow), "an item row").toEqual({ itemRef: ID, listed: ITEM });
  expect(rowPreview(unparseableRow)?.listed, "an item row without an id").toBe(UNPARSEABLE);
  expect(rowPreview(pendingRow), "a pending create").toBeUndefined();
  expect(rowPreview(missingRow), "a missing item").toBeUndefined();

  // The keyboard mode over item, item, header, item: which row's box is open after each step.
  const boxed: Record<string, boolean> = { a: true, b: true, header: false, c: true };
  let keys: PreviewKeys = { on: false, openKey: undefined };
  const apply = (key: string, action: "open" | "close" | undefined): void => {
    if (action === "open") keys = { ...keys, openKey: key };
    if (action === "close") keys = { ...keys, openKey: undefined };
  };
  const space = (key: string): void => {
    const { on, action } = previewOnSpace(keys, key, boxed[key] ?? false);
    keys = { ...keys, on };
    apply(key, action);
  };
  const focus = (key: string): void => apply(key, previewOnFocus(keys, key, boxed[key] ?? false));
  const steps: [string, () => void, PreviewKeys][] = [
    ["space on a header with the mode off", () => space("header"), { on: false, openKey: undefined }],
    ["space on an item", () => space("a"), { on: true, openKey: "a" }],
    ["focus to the next item", () => focus("b"), { on: true, openKey: "b" }],
    ["focus to a header", () => focus("header"), { on: true, openKey: undefined }],
    ["focus to the item after it", () => focus("c"), { on: true, openKey: "c" }],
    ["space again", () => space("c"), { on: false, openKey: undefined }],
    ["focus to an item with the mode off", () => focus("a"), { on: false, openKey: undefined }],
    ["focus to another item with the mode off", () => focus("b"), { on: false, openKey: undefined }],
  ];
  for (const [what, step, expected] of steps) {
    step();
    expect(keys, what).toEqual(expected);
  }

  // The name of an item it can't show: a handle as is, never an id.
  fc.assert(
    fc.property(fc.uuid(), (id) => {
      expect(previewName(id)).not.toMatch(UUID);
      expect(previewName(id, summary(3, { id, handle: null }))).not.toMatch(UUID);
    }),
  );
  expect(previewName(ID), "an id ref").toBe("This item");
  expect(previewName("HV-404"), "a handle ref").toBe("HV-404");
  expect(previewName(ID, summary(4, { id: ID, handle: "HV-4" })), "a listing's handle").toBe("HV-4");
  expect(previewName("hives/HV-2.md", UNPARSEABLE), "a listing without a handle").toBe("This item");
});
