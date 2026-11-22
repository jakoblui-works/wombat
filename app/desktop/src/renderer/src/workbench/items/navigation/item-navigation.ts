import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type { BinderSummary, Item } from "@wombat/shared/items";

import { newCommandId } from "../../../data/commands.ts";
import { bindersQuery, itemQuery } from "../../../data/query-client.ts";
import { asError, asSentence } from "../../../lib/errors.ts";
import { DESK_ACTIVITY, DESK_PANEL } from "../../activity-ids.ts";
import { openTabs, showTab, sidebarRevealKey } from "../../tabs.ts";
import { tell } from "../../Toast/Toast.tsx";
import { type OpenOptions, type TabRef, useWorkbench, type WorkbenchContextValue } from "../../workbench-context.ts";
import { previewName } from "../ItemPreview/item-preview.ts";
import { ITEM_PANEL, type ItemParams, NEW_ITEM_TITLE, showsItem } from "../item-params.ts";
import { READ_FAILED } from "../notices/notices.tsx";
import { isItemNotFound, itemNotFound } from "../reads.ts";
import { type DeskState, useChangeDesk } from "./desk-state.ts";
import { binderPlace, followPlace, showBinder } from "./places.ts";

/** What the item navigation acts on: the workbench, the page's query client and the Desk's change function. */
export type ItemNavigator ={ workbench: WorkbenchContextValue; queryClient: QueryClient; changeDesk: DeskState["changeDesk"] };

/** The binders, read when the page has none yet; undefined when they can't be. */
const readBinders = (queryClient: QueryClient): Promise<readonly BinderSummary[] | undefined> =>
  queryClient.ensureQueryData(bindersQuery()).then(({ binders }) => binders, () => undefined);

/** The item read afresh by id or handle; undefined when the service finds none, rejects on any other failure. */
const readItemAfresh = (queryClient: QueryClient, ref: string): Promise<Item | undefined> =>
  queryClient.fetchQuery({ ...itemQuery(ref), staleTime: 0 }).catch((error: unknown) => {
    if (isItemNotFound(error)) return undefined;
    throw error;
  });

const itemUnread = (error: unknown): string => `${READ_FAILED.item}: ${asSentence(asError(error).message)} Try again once the service answers.`;

/**
 * Switches to the Desk and shows the binder in its sidebar on its view `view` (else its first), else as a list of its
 * items. `reveal` (a proposal id or an item id) reaches the Desk's sidebar.
 */
export const openBinder = ({ workbench, queryClient, changeDesk }: ItemNavigator, binderId: string, reveal?: string, view?: string): void => {
  if (workbench.host === undefined) return;
  void readBinders(queryClient).then((binders) => {
    const place = binderPlace(binders?.find(({ id }) => id === binderId), view);
    workbench.reveals.set(sidebarRevealKey(DESK_PANEL), reveal === undefined ? undefined : { target: reveal });
    changeDesk((desk) => showBinder(desk, binderId, place.sidebarView));
    workbench.showActivity(DESK_ACTIVITY);
  });
};

/**
 * Opens or focuses the item's tab. A `temporary` tab takes the place of its group's temporary tab and is replaced by
 * the next one, until it's kept (`keepTab`); a tab opened again without it is kept.
 */
export const openItem = ({ workbench }: ItemNavigator, binderId: string, itemId: string, options?: OpenOptions): void => {
  if (workbench.host === undefined) return;
  showTab(workbench.host, workbench.reveals, ITEM_PANEL, { binderId, itemId } satisfies ItemParams, workbench.titleContext(), undefined, {
    temporary: options?.temporary === true,
  });
};

/** Opens a new tab on an item not written yet in the binder, starting with `context`'s values (`viewContext`). */
export const openNewItem = ({ workbench }: ItemNavigator, binderId: string, context: Record<string, unknown>): void => {
  if (workbench.host === undefined) return;
  const params = { binderId, draft: newCommandId(), context } satisfies ItemParams;
  showTab(workbench.host, workbench.reveals, ITEM_PANEL, params, workbench.titleContext(), undefined, { title: NEW_ITEM_TITLE });
};

// The page's one count of follows: only the latest lands, so one whose read comes back after a later follow's does nothing.
let follows = 0;

/**
 * Shows the item (`ref`: its id or a handle) where it sits: the Desk's sidebar on its binder's first view, the item's
 * row revealed, and the item in a temporary tab. For a ref that names no item, opens nothing and tells the user.
 */
export const followItem = (navigator: ItemNavigator, ref: string): void => {
  if (navigator.workbench.host === undefined) return;
  follows += 1;
  const follow = follows;
  void readItemAfresh(navigator.queryClient, ref).then(
    (item) => {
      if (follow !== follows) return;
      const place = followPlace(item);
      if (place === undefined) {
        tell(itemNotFound(previewName(ref)));
        return;
      }
      openBinder(navigator, place.binderId, place.itemId);
      openItem(navigator, place.binderId, place.itemId, { temporary: true });
    },
    (error: unknown) => {
      if (follow === follows) tell(itemUnread(error));
    },
  );
};

/** The open tabs on item `itemId`, whichever binder each was opened from (its file may have moved since). */
export const itemTabs = ({ workbench }: { workbench: Pick<WorkbenchContextValue, "host"> }, itemId: string): TabRef[] =>
  workbench.host === undefined ? [] : openTabs(workbench.host, ITEM_PANEL).filter((tab) => showsItem(tab.params, itemId));

export type ItemNavigation = {
  openBinder: (binderId: string, reveal?: string, view?: string) => void;
  openItem: (binderId: string, itemId: string, options?: OpenOptions) => void;
  openNewItem: (binderId: string, context: Record<string, unknown>) => void;
  followItem: (ref: string) => void;
  itemTabs: (itemId: string) => TabRef[];
};

export const useItemNavigation = (): ItemNavigation => {
  const workbench = useWorkbench();
  const queryClient = useQueryClient();
  const changeDesk = useChangeDesk();
  return useMemo(() => {
    const navigator: ItemNavigator ={ workbench, queryClient, changeDesk };
    return {
      openBinder: (binderId, reveal, view) => openBinder(navigator, binderId, reveal, view),
      openItem: (binderId, itemId, options) => openItem(navigator, binderId, itemId, options),
      openNewItem: (binderId, context) => openNewItem(navigator, binderId, context),
      followItem: (ref) => followItem(navigator, ref),
      itemTabs: (itemId) => itemTabs(navigator, itemId),
    };
  }, [workbench, queryClient, changeDesk]);
};
