// What the Desk's sidebar shows, pure.
import { ItemsErrorCode } from "@wombat/shared/api";
import type { BinderSummary, LenientView } from "@wombat/shared/items";

import { ServiceError } from "../../../data/client.ts";
import type { Binder } from "../../items/binders.ts";
import type { DeskLayout } from "../../items/navigation/desk-layout.ts";
import { shownView } from "../../items/navigation/places.ts";
import { type DeskNode, deskTree } from "./desk-tree.ts";

export type DeskContent =
  | { kind: "loading" }
  | { kind: "no-root" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "tree"; nodes: DeskNode[] }
  | { kind: "binder"; binder: Binder; view: LenientView | undefined };

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
  const shown = desk.binderId === undefined ? undefined : binders.find((binder): binder is Binder => binder.id === desk.binderId);
  if (shown !== undefined) return { kind: "binder", binder: shown, view: shownView(shown, desk.view) };
  return { kind: "tree", nodes: deskTree(binders) };
};

/** The Desk back on its tree; the open drawers stay. */
export const showTree = (desk: DeskLayout): DeskLayout => ({ openDrawers: desk.openDrawers });
