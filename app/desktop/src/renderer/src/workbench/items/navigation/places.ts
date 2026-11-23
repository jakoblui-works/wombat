import type { BinderSummary, ItemSummary, LenientView } from "@wombat/shared/items";

import type { DeskLayout } from "./desk-layout.ts";
import { itemTabParams, type SavedItemParams } from "../item-params.ts";

const viewsOf = (binder: BinderSummary | undefined): readonly LenientView[] => (binder === undefined || binder.id === null ? [] : binder.views);

/** The view to show in the sidebar (none: what it shows for the binder stays). */
type BinderPlace = { sidebarView?: string };

/** Where a binder opens: in the sidebar, on its view `viewName` (else its first); a binder without views as a list of its items. */
export const binderPlace = (binder: BinderSummary | undefined, viewName?: string): BinderPlace => {
  const view = shownView(binder, viewName);
  return view === undefined ? {} : { sidebarView: view.name };
};

/** Where following an item lands: its binder (on its first view, `binderPlace`) with the item's row revealed, and the item's tab. */
type FollowPlace = SavedItemParams;

/** Where following `item` of workspace `ws` lands; undefined for no item or one without an id. */
export const followPlace = (ws: string, item: Pick<ItemSummary, "id" | "binder"> | undefined): FollowPlace | undefined =>
  item === undefined || item.id === null ? undefined : itemTabParams(ws, { binder: item.binder, id: item.id });

/** The view the sidebar shows for a binder: view `viewName`, else its first; undefined for none. */
export const shownView = (binder: BinderSummary | undefined, viewName: string | undefined): LenientView | undefined => {
  const views = viewsOf(binder);
  return views.find(({ name }) => name === viewName) ?? views[0];
};

/**
 * The Desk showing `binderId` on `view` in its sidebar; without a view, the binder keeps the view it shows (if it is
 * the one shown). The open drawers stay.
 */
export const showBinder = (desk: DeskLayout, binderId: string, view: string | undefined): DeskLayout => {
  const kept = view ?? (desk.binderId === binderId ? desk.view : undefined);
  return { openDrawers: desk.openDrawers, binderId, ...(kept === undefined ? {} : { view: kept }) };
};
