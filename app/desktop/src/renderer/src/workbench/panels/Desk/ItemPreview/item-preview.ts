// Which row the preview box is on, pure.
import type { ItemSummary } from "@wombat/shared/items";

import { isItemRow, type Row } from "../view-model/view-model.ts";

/** What a row's box previews: an item row's item by id (or, without one, its path, which isn't read) and its listing. */
export type PreviewTarget = { itemRef: string; listed: ItemSummary };

/** The box of a row; none for a pending create or a missing item. */
export const rowPreview = (row: Row): PreviewTarget | undefined => (isItemRow(row) ? { itemRef: row.item.id ?? row.item.path, listed: row.item } : undefined);

/**
 * The box's keyboard mode: once Space turns it on, the box follows the focus through the view, hidden on rows without
 * one, until Space, Escape, Enter or the focus leaving the view turns it off. `openKey`: the row it's open on.
 */
export type PreviewKeys = { on: boolean; openKey: string | undefined };

/** Space on row `key`: turns the box off when it's on or open there, else on and open there when the row has one. */
export const previewOnSpace = ({ on, openKey }: PreviewKeys, key: string, previewable: boolean): { on: boolean; action: "open" | "close" } =>
  !on && openKey !== key && previewable ? { on: true, action: "open" } : { on: false, action: "close" };

/** Focus moving to row `key`: while on, the box shows there, or hides on a row without one; otherwise nothing. */
export const previewOnFocus = ({ on, openKey }: PreviewKeys, key: string, previewable: boolean): "open" | "close" | undefined => {
  if (!on) return undefined;
  if (!previewable) return openKey === undefined ? undefined : "close";
  return openKey === key ? undefined : "open";
};
