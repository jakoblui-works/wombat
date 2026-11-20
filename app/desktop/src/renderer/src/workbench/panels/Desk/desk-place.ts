// Where a binder opens and what the Desk's sidebar shows, pure.
import { ItemsErrorCode } from "@wombat/shared/api";
import type { BinderSummary, LenientView } from "@wombat/shared/items";

import { ServiceError } from "../../../data/client.ts";
import type { DeskLayout } from "../../layout.ts";
import { type DeskNode, deskTree } from "./desk-tree.ts";

type OpenableBinder = Extract<BinderSummary, { id: string }>;

const viewsOf = (binder: BinderSummary | undefined): readonly LenientView[] => (binder === undefined || binder.id === null ? [] : binder.views);

/** The view to show in the sidebar (none: what it shows for the binder stays). */
export type BinderPlace = { sidebarView?: string };

/** Where a binder opens: in the sidebar, on its view `viewName` (else its first); a binder without views as a list of its items. */
export const binderPlace = (binder: BinderSummary | undefined, viewName?: string): BinderPlace => {
  const view = shownView(binder, viewName);
  return view === undefined ? {} : { sidebarView: view.name };
};

/** The view the sidebar shows for a binder: view `viewName`, else its first; undefined for none. */
const shownView = (binder: BinderSummary | undefined, viewName: string | undefined): LenientView | undefined => {
  const views = viewsOf(binder);
  return views.find(({ name }) => name === viewName) ?? views[0];
};

export type DeskContent =
  | { kind: "loading" }
  | { kind: "no-root" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "tree"; nodes: DeskNode[] }
  | { kind: "binder"; binder: OpenableBinder; view: LenientView | undefined };

/**
 * What the Desk's sidebar shows: the binder the Desk was left on while it is listed and readable, else the tree; an
 * empty state when the service has no items root or the root holds no binder.
 */
export const deskContent = (binders: readonly BinderSummary[] | undefined, error: Error | null, desk: DeskLayout): DeskContent => {
  if (binders === undefined) {
    if (error === null) return { kind: "loading" };
    return error instanceof ServiceError && error.code === ItemsErrorCode.enum.items_not_configured ? { kind: "no-root" } : { kind: "error", message: error.message };
  }
  if (binders.length === 0) return { kind: "empty" };
  const shown = desk.binderId === undefined ? undefined : binders.find((binder): binder is OpenableBinder => binder.id === desk.binderId);
  if (shown !== undefined) return { kind: "binder", binder: shown, view: shownView(shown, desk.view) };
  return { kind: "tree", nodes: deskTree(binders) };
};

/**
 * The Desk showing `binderId` on `view` in its sidebar; without a view, the binder keeps the view it shows (if it is
 * the one shown). The open drawers stay.
 */
export const showBinder = (desk: DeskLayout, binderId: string, view: string | undefined): DeskLayout => {
  const kept = view ?? (desk.binderId === binderId ? desk.view : undefined);
  return { openDrawers: desk.openDrawers, binderId, ...(kept === undefined ? {} : { view: kept }) };
};

/** The Desk back on its tree; the open drawers stay. */
export const showTree = (desk: DeskLayout): DeskLayout => ({ openDrawers: desk.openDrawers });
