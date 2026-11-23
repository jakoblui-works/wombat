import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useOpenAgentChat } from "../../agents/open-agent-chat.ts";
import { readBinders, readItemAfresh, useItemNavigation } from "../../items/navigation/item-navigation.ts";
import { useOpenProposal } from "../../proposals/use-open-proposal.ts";
import { useOpenTicket } from "../../shell/open-ticket.ts";
import { hideNavigator, type ShellState, showWorkspace } from "../../shell/shell-state.ts";
import { useShell } from "../../shell/ShellProvider.tsx";
import type { NeedsMeRow } from "./needs-me-rows.ts";
import { type ItemOpen, itemOpen, type RowTarget, rowTarget } from "./row-target.ts";

type Open = ReturnType<typeof itemOpen>;

/** An item target once its workspace's binders and the item (read afresh by handle) are read. */
const readItemTarget = async (queryClient: QueryClient, target: Extract<RowTarget, { open: "item" }>): Promise<Open> => {
  const [binders, item] = await Promise.all([
    readBinders(queryClient, target.workspace),
    readItemAfresh(queryClient, target.workspace, target.handle).catch(() => undefined),
  ]);
  return itemOpen(target, binders, item?.id ?? undefined);
};

/** Opens a row where it is decided (`rowTarget`), showing its workspace first; an item target lands once its reads are back. */
export const useOpenRow = (): ((row: NeedsMeRow) => void) => {
  const queryClient = useQueryClient();
  const { change, current } = useShell();
  const { take, land } = useOpenTicket();
  const { showItem } = useItemNavigation();
  const openProposal = useOpenProposal();
  const openAgentChat = useOpenAgentChat();

  const openItem = useCallback(
    (open: ItemOpen) => {
      change((state) => hideNavigator(state, open.workspace, false));
      showItem({ ws: open.workspace, binderId: open.binderId, itemId: open.itemId }, open.proposalId);
    },
    [change, showItem],
  );

  return useCallback(
    (row: NeedsMeRow) => {
      const target = rowTarget(row);
      if (target.open === "chat") {
        take();
        openAgentChat(target.agentId, target.requestId);
        return;
      }
      const { agents, workspaces } = current();
      const shown = (state: ShellState) => showWorkspace(state, target.workspace, agents, workspaces);
      change(shown);
      if (target.open === "proposal") {
        take();
        openProposal(target.proposalId, { workspace: target.workspace });
        return;
      }
      const ticket = take(shown);
      void readItemTarget(queryClient, target).then((open) => {
        land(ticket, () => {
          if (open.open === "item") openItem(open);
          else openProposal(open.proposalId, { workspace: open.workspace });
        });
      });
    },
    [queryClient, change, current, take, land, openAgentChat, openProposal, openItem],
  );
};
