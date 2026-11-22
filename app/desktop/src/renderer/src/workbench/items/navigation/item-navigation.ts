import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type { BinderSummary, Item } from "@wombat/shared/items";

import { newCommandId } from "../../../data/commands.ts";
import { bindersQuery, itemQuery } from "../../../data/query-client.ts";
import { showWorkspace } from "../../../data/shown-workspace.ts";
import { asError, asSentence } from "../../../lib/errors.ts";
import { DESK_ACTIVITY, DESK_PANEL } from "../../activity-ids.ts";
import { sidebarRevealKey } from "../../tabs.ts";
import { tell } from "../../Toast/Toast.tsx";
import { type OpenOptions, type TabRef, useWorkbench, type WorkbenchContextValue } from "../../workbench-context.ts";
import { previewName } from "../ItemPreview/item-preview.ts";
import { ITEM_PANEL, type ItemParams, NEW_ITEM_TITLE, showsItem } from "../item-params.ts";
import { READ_FAILED } from "../notices/notices.tsx";
import { isItemNotFound, itemNotFound } from "../reads.ts";
import { type DeskState, useChangeDesk } from "./desk-state.ts";
import { binderPlace, followPlace, showBinder } from "./places.ts";

export type ItemNavigator = {
  workbench: WorkbenchContextValue;
  queryClient: QueryClient;
  changeDesk: DeskState["changeDesk"];
  tell: (message: string) => void;
};

/** Workspace `ws`'s binders, read when the page has none yet; undefined when they can't be. */
const readBinders = (queryClient: QueryClient, ws: string): Promise<readonly BinderSummary[] | undefined> =>
  queryClient.ensureQueryData(bindersQuery(ws)).then(({ binders }) => binders, () => undefined);

/** Workspace `ws`'s item read afresh by id or handle; undefined when the service finds none, rejects on any other failure. */
const readItemAfresh = (queryClient: QueryClient, ws: string, ref: string): Promise<Item | undefined> =>
  queryClient.fetchQuery({ ...itemQuery(ws, ref), staleTime: 0 }).catch((error: unknown) => {
    if (isItemNotFound(error)) return undefined;
    throw error;
  });

const itemUnread = (error: unknown): string => `${READ_FAILED.item}: ${asSentence(asError(error).message)} Try again once the service answers.`;

/**
 * Shows workspace `ws`, switches to the Desk and shows the binder in its sidebar on its view `view` (else its first),
 * else as a list of its items. `reveal` (a proposal id or an item id) reaches the Desk's sidebar.
 */
export const openBinder = ({ workbench, queryClient, changeDesk }: ItemNavigator, ws: string, binderId: string, reveal?: string, view?: string): void => {
  void readBinders(queryClient, ws).then((binders) => {
    const place = binderPlace(binders?.find(({ id }) => id === binderId), view);
    showWorkspace(ws);
    workbench.reveals.set(sidebarRevealKey(DESK_PANEL), reveal === undefined ? undefined : { target: reveal });
    changeDesk((desk) => showBinder(desk, binderId, place.sidebarView));
    workbench.showActivity(DESK_ACTIVITY);
  });
};

/**
 * Opens or focuses the tab of workspace `ws`'s item. A `temporary` tab takes the place of its group's temporary tab and
 * is replaced by the next one, until it's kept (`keepTab`); a tab opened again without it is kept.
 */
export const openItem = ({ workbench }: ItemNavigator, ws: string, binderId: string, itemId: string, options?: OpenOptions): void => {
  workbench.openTab(ITEM_PANEL, { ws, binderId, itemId } satisfies ItemParams, undefined, { workspace: ws, temporary: options?.temporary === true });
};

/** Opens a new tab on an item not written yet in workspace `ws`'s binder, starting with `context`'s values (`viewContext`). */
export const openNewItem = ({ workbench }: ItemNavigator, ws: string, binderId: string, context: Record<string, unknown>): void => {
  const params = { ws, binderId, draft: newCommandId(), context } satisfies ItemParams;
  workbench.openTab(ITEM_PANEL, params, undefined, { workspace: ws, title: NEW_ITEM_TITLE });
};

// The page's one count of follows: only the latest lands, so one whose read comes back after a later follow's does nothing.
let follows = 0;

/**
 * Shows workspace `ws`'s item (`ref`: its id or a handle) where it sits: the Desk's sidebar on its binder's first
 * view, the item's row revealed, and the item in a temporary tab. For a ref that names no item, opens nothing and
 * tells the user.
 */
export const followItem = (navigator: ItemNavigator, ws: string, ref: string): void => {
  follows += 1;
  const follow = follows;
  void readItemAfresh(navigator.queryClient, ws, ref).then(
    (item) => {
      if (follow !== follows) return;
      const place = followPlace(ws, item);
      if (place === undefined) {
        navigator.tell(itemNotFound(previewName(ref)));
        return;
      }
      openBinder(navigator, place.ws, place.binderId, place.itemId);
      openItem(navigator, place.ws, place.binderId, place.itemId, { temporary: true });
    },
    (error: unknown) => {
      if (follow === follows) navigator.tell(itemUnread(error));
    },
  );
};

/** The open tabs on item `itemId`, whichever binder each was opened from (its file may have moved since). */
export const itemTabs = ({ workbench }: { workbench: Pick<WorkbenchContextValue, "openTabs"> }, itemId: string): TabRef[] =>
  workbench.openTabs(ITEM_PANEL).filter((tab) => showsItem(tab.params, itemId));

type ItemNavigation = {
  openBinder: (ws: string, binderId: string, reveal?: string, view?: string) => void;
  openItem: (ws: string, binderId: string, itemId: string, options?: OpenOptions) => void;
  openNewItem: (ws: string, binderId: string, context: Record<string, unknown>) => void;
  followItem: (ws: string, ref: string) => void;
  itemTabs: (itemId: string) => TabRef[];
};

export const useItemNavigation = (): ItemNavigation => {
  const workbench = useWorkbench();
  const queryClient = useQueryClient();
  const changeDesk = useChangeDesk();
  return useMemo(() => {
    const navigator: ItemNavigator = { workbench, queryClient, changeDesk, tell };
    return {
      openBinder: (ws, binderId, reveal, view) => openBinder(navigator, ws, binderId, reveal, view),
      openItem: (ws, binderId, itemId, options) => openItem(navigator, ws, binderId, itemId, options),
      openNewItem: (ws, binderId, context) => openNewItem(navigator, ws, binderId, context),
      followItem: (ws, ref) => followItem(navigator, ws, ref),
      itemTabs: (itemId) => itemTabs(navigator, itemId),
    };
  }, [workbench, queryClient, changeDesk]);
};
